import { ChangeDetectionStrategy, Component, ElementRef, ViewChild, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GeminiService } from '../../services/gemini.service';
import { ChatMessage, ChatPart, Place, UserImagePart } from '../../models/app.models';

@Component({
  selector: 'app-chat',
  imports: [CommonModule, FormsModule],
  templateUrl: './chat.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    'class': 'h-full flex flex-col'
  }
})
export class ChatComponent {
  @ViewChild('chatContainer') private chatContainer!: ElementRef;

  private geminiService = inject(GeminiService);
  private nextId = 0;
  
  private readonly initialMessages: ChatMessage[] = [
    {
      id: this.nextId++,
      role: 'model',
      parts: [{ type: 'text', content: 'Pozdrav! Upišite ime pića ili pošaljite sliku. Za preciznije rezultate, podijelite svoju lokaciju klikom na ikonu 📍.' }]
    }
  ];

  userInput = signal('');
  userImage = signal<UserImagePart | undefined>(undefined);
  messages = signal<ChatMessage[]>([...this.initialMessages]);
  isLoading = signal(false);
  userLocation = signal<{latitude: number, longitude: number} | null>(null);
  copiedPlaceName = signal<string | null>(null);
  quickSuggestions = ['Pivo', 'Vino', 'Koktel', 'Kava'];

  isModelStreaming = computed(() => {
    if (!this.isLoading()) return false;
    const lastMessage = this.messages().at(-1);
    return lastMessage?.role === 'model' && lastMessage.parts.length > 0;
  });

  constructor() {
    effect(() => {
      if (this.messages()) {
        this.scrollToBottom();
      }
    });
  }

  resetChat(): void {
    this.messages.set([...this.initialMessages]);
    this.userInput.set('');
    this.userImage.set(undefined);
    this.userLocation.set(null);
    this.isLoading.set(false);
  }

  selectSuggestion(suggestion: string): void {
    if (this.isLoading()) return;
    this.userInput.set(suggestion);
    this.sendMessage();
  }

  async sendMessage(): Promise<void> {
    const textInput = this.userInput().trim();
    const image = this.userImage();
    
    if (!textInput && !image) return;

    let prompt = textInput;
    const location = this.userLocation();
    if (location) {
      prompt = `${prompt} Moja lokacija je: ${location.latitude}, ${location.longitude}.`;
    }

    const userParts: ChatPart[] = [];
    if (textInput) userParts.push({ type: 'text', content: textInput });
    if (image) userParts.push(image);
    this.messages.update(m => [...m, { id: this.nextId++, role: 'user', parts: userParts }]);
    
    this.userInput.set('');
    this.userImage.set(undefined);
    this.isLoading.set(true);

    const modelMessageId = this.nextId++;
    this.messages.update(m => [...m, { id: modelMessageId, role: 'model', parts: [] }]);

    try {
      const imageBase64 = image?.url.split(',')[1];
      const stream = this.geminiService.generateResponseStream(prompt, imageBase64);
      
      let fullResponseText = '';
      let finalResponse;

      for await (const chunk of stream) {
        fullResponseText += chunk.text;
        finalResponse = chunk;
        this.messages.update(msgs => {
          const lastMsg = msgs.at(-1);
          if (lastMsg?.id === modelMessageId) {
            return [
              ...msgs.slice(0, -1),
              { ...lastMsg, parts: [{ type: 'text', content: fullResponseText }] }
            ];
          }
          return msgs;
        });
      }

      if (finalResponse) {
        const parsedParts = this.geminiService.parseResponse(fullResponseText, finalResponse);
        this.messages.update(msgs => {
          const lastMsg = msgs.at(-1);
          if (lastMsg?.id === modelMessageId) {
             return [
              ...msgs.slice(0, -1),
              { ...lastMsg, parts: parsedParts.length > 0 ? parsedParts : [{ type: 'text', content: fullResponseText }] }
            ];
          }
          return msgs;
        });
      } else if (fullResponseText) {
         this.messages.update(msgs => {
          const lastMsg = msgs.at(-1);
          if (lastMsg?.id === modelMessageId) {
             return [
              ...msgs.slice(0, -1),
              { ...lastMsg, parts: [{ type: 'text', content: fullResponseText }] }
            ];
          }
          return msgs;
        });
      }
    } catch (error) {
      console.error('API Error:', error);
      const errorMessage = (error instanceof Error && error.message.includes('API key not valid'))
        ? 'Vaš API ključ nije važeći. Provjerite postavke.'
        : (error instanceof Error && error.message.includes('quota'))
          ? 'Dosegnuli ste ograničenje za API. Molimo pokušajte kasnije.'
          : 'Došlo je do neočekivane pogreške. Molimo pokušajte ponovno.';

      this.messages.update(msgs => {
        const lastMsg = msgs.at(-1);
        if (lastMsg?.id === modelMessageId) {
          return [
            ...msgs.slice(0, -1),
            { ...lastMsg, parts: [{ type: 'error', message: errorMessage }] }
          ];
        }
        return [...msgs, { id: modelMessageId, role: 'model', parts: [{ type: 'error', message: errorMessage }] }];
      });
    } finally {
      this.isLoading.set(false);
      this.scrollToBottom();
    }
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];
      const reader = new FileReader();
      reader.onload = (e) => {
        this.userImage.set({
          type: 'user-image',
          url: e.target?.result as string
        });
      };
      reader.readAsDataURL(file);
    }
  }

  removeImage(): void {
    this.userImage.set(undefined);
  }

  requestLocation(): void {
    if (this.userLocation()) {
      this.userLocation.set(null);
      this.messages.update(m => [...m, {
        id: this.nextId++,
        role: 'model',
        parts: [{ type: 'text', content: 'Vaša lokacija više neće biti korištena.' }]
      }]);
      return;
    }

    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          this.userLocation.set({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude
          });
          this.messages.update(m => [...m, {
            id: this.nextId++,
            role: 'model',
            parts: [{ type: 'text', content: 'Lokacija je uspješno podijeljena i bit će korištena za sljedeću pretragu.' }]
          }]);
        },
        (error) => {
          console.error('Geolocation error:', error);
          let errorMessage = 'Nije moguće dohvatiti lokaciju. Provjerite dozvole u pregledniku.';
          switch(error.code) {
            case error.PERMISSION_DENIED:
              errorMessage = 'Dozvola za lokaciju je odbijena. Molimo omogućite je u postavkama preglednika.';
              break;
            case error.POSITION_UNAVAILABLE:
              errorMessage = 'Informacije o lokaciji su nedostupne. Pokušajte ponovno.';
              break;
            case error.TIMEOUT:
              errorMessage = 'Isteklo je vrijeme za dohvaćanje lokacije. Pokušajte ponovno.';
              break;
          }
          this.messages.update(m => [...m, { 
              id: this.nextId++, 
              role: 'model', 
              parts: [{ type: 'error', message: errorMessage }] 
          }]);
        }
      );
    } else {
        this.messages.update(m => [...m, { 
            id: this.nextId++, 
            role: 'model', 
            parts: [{ type: 'error', message: 'Geolokacija nije podržana u vašem pregledniku.' }] 
        }]);
    }
  }

  async sharePlace(place: Place): Promise<void> {
    const shareText = `Evo preporuke za piće: ${place.name}\nAdresa: ${place.address || 'Nije dostupna'}\n${place.mapLink ? 'Karta: ' + place.mapLink : ''}`;
    
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Preporuka: ${place.name}`,
          text: shareText,
          url: place.mapLink || window.location.href
        });
      } catch (error) {
        console.error('Greška pri dijeljenju:', error);
      }
    } else {
      try {
        await navigator.clipboard.writeText(shareText);
        this.copiedPlaceName.set(place.name);
        setTimeout(() => this.copiedPlaceName.set(null), 2000);
      } catch (err) {
        console.error('Nije uspjelo kopiranje:', err);
      }
    }
  }

  togglePlaceDetails(placeToToggle: Place): void {
    this.messages.update(currentMessages => 
      currentMessages.map(message => {
        if (message.role === 'model') {
          return {
            ...message,
            parts: message.parts.map(part => {
              if (part.type === 'locations') {
                return {
                  ...part,
                  places: part.places.map(p => 
                    p === placeToToggle ? { ...p, expanded: !p.expanded } : p
                  )
                };
              }
              return part;
            })
          };
        }
        return message;
      })
    );
  }

  private scrollToBottom(): void {
    try {
      if (this.chatContainer?.nativeElement) {
        setTimeout(() => {
            this.chatContainer.nativeElement.scrollTop = this.chatContainer.nativeElement.scrollHeight;
        }, 0);
      }
    } catch (err) {
      console.error('Could not scroll to bottom:', err);
    }
  }
}