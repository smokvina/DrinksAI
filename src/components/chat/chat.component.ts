import { ChangeDetectionStrategy, Component, ElementRef, ViewChild, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GeminiService } from '../../services/gemini.service';
import { ChatMessage, ChatPart, Place, UserImagePart } from '../../models/app.models';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './chat.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatComponent {
  @ViewChild('chatContainer') private chatContainer!: ElementRef;

  private geminiService = inject(GeminiService);
  
  userInput = signal('');
  userImage = signal<UserImagePart | undefined>(undefined);
  messages = signal<ChatMessage[]>([
    {
      id: Date.now(),
      role: 'model',
      parts: [{ type: 'text', content: 'Pozdrav! Upišite ime pića ili pošaljite sliku. Za preciznije rezultate, podijelite svoju lokaciju klikom na ikonu 📍.' }]
    }
  ]);
  isLoading = signal(false);
  userLocation = signal<{latitude: number, longitude: number} | null>(null);
  copiedPlaceName = signal<string | null>(null);

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
    this.messages.update(m => [...m, { id: Date.now(), role: 'user', parts: userParts }]);
    
    this.userInput.set('');
    this.userImage.set(undefined);
    this.isLoading.set(true);

    const modelMessageId = Date.now();
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
      } else {
        this.messages.update(msgs => msgs.filter(m => m.id !== modelMessageId));
      }

    } catch (e: any) {
      this.messages.update(msgs => {
          const lastMsg = msgs.at(-1);
          if (lastMsg?.id === modelMessageId) {
             return [
              ...msgs.slice(0, -1),
              { ...lastMsg, parts: [{ type: 'error', message: e.message || 'Došlo je do pogreške.' }] }
            ];
          }
          return msgs;
      });
    } finally {
      this.isLoading.set(false);
    }
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];
      const reader = new FileReader();
      reader.onload = (e: any) => {
        this.userImage.set({ type: 'user-image', url: e.target.result });
        // Automatically trigger send when an image is selected
        this.sendMessage();
      }
      reader.readAsDataURL(file);
      input.value = '';
    }
  }

  removeImage(): void {
    this.userImage.set(undefined);
  }

  requestLocation(): void {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          this.userLocation.set({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          });
          const locationMessage: ChatMessage = {
            id: Date.now(),
            role: 'model',
            parts: [{ type: 'text', content: '✅ Lokacija spremljena! Pretraga će sada biti preciznija.' }]
          };
          this.messages.update(m => [...m, locationMessage]);
        },
        (error) => {
          let errorMessage = 'Došlo je do greške prilikom dohvaćanja lokacije.';
          switch(error.code) {
            case error.PERMISSION_DENIED:
              errorMessage = "Odbili ste zahtjev za geolokaciju.";
              break;
            case error.POSITION_UNAVAILABLE:
              errorMessage = "Informacije o lokaciji nisu dostupne.";
              break;
            case error.TIMEOUT:
              errorMessage = "Isteklo je vrijeme zahtjeva za dohvaćanje lokacije.";
              break;
          }
           const errorChatMessage: ChatMessage = {
            id: Date.now(),
            role: 'model',
            parts: [{ type: 'error', message: errorMessage }]
          };
          this.messages.update(m => [...m, errorChatMessage]);
        }
      );
    } else {
       const errorChatMessage: ChatMessage = {
        id: Date.now(),
        role: 'model',
        parts: [{ type: 'error', message: 'Geolokacija nije podržana u ovom pregledniku.' }]
      };
      this.messages.update(m => [...m, errorChatMessage]);
    }
  }

  async sharePlace(place: Place): Promise<void> {
    const shareData = {
      title: `Preporuka za piće: ${place.name}`,
      text: `Evo super mjesta za piće: ${place.name}, nalazi se na adresi ${place.address || 'Nepoznata adresa'}.`,
      url: place.mapLink || window.location.href,
    };

    if (navigator.share) {
      try {
        await navigator.share(shareData);
      } catch (err) {
        console.error('Error sharing:', err);
      }
    } else {
      // Fallback to clipboard
      const clipboardText = `${shareData.title}\n${shareData.text}\nLink: ${shareData.url}`;
      try {
        await navigator.clipboard.writeText(clipboardText);
        this.copiedPlaceName.set(place.name);
        setTimeout(() => this.copiedPlaceName.set(null), 2000); // Reset after 2 seconds
      } catch (err) {
        console.error('Failed to copy: ', err);
      }
    }
  }

  private scrollToBottom(): void {
    setTimeout(() => {
      this.chatContainer?.nativeElement?.scrollTo({
        top: this.chatContainer.nativeElement.scrollHeight,
        behavior: 'smooth'
      });
    }, 100);
  }

  isTextPart(part: ChatPart): part is ChatPart & { type: 'text' } { return part.type === 'text'; }
  isUserImagePart(part: ChatPart): part is ChatPart & { type: 'user-image' } { return part.type === 'user-image'; }
  isLocationsPart(part: ChatPart): part is ChatPart & { type: 'locations' } { return part.type === 'locations'; }
  isErrorPart(part: ChatPart): part is ChatPart & { type: 'error' } { return part.type === 'error'; }
}
