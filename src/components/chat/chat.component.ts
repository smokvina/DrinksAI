import { ChangeDetectionStrategy, Component, ElementRef, ViewChild, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser'; // Removed SafeResourceUrl
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
  private sanitizer = inject(DomSanitizer);
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
  copiedMessageId = signal<number | null>(null); // New signal for copied message feedback

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

  // Helper to validate if a string is a valid HTTP/HTTPS URL
  isValidHttpUrl(s: string): boolean {
    try {
      const url = new URL(s);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch (_) {
      return false;
    }
  }

  linkify(text: string): SafeHtml {
    // Regex to find URLs: looks for http/https/ftp protocols or www. prefix.
    const urlRegex = /(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])|(\bwww\.[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/ig;
    
    let result = '';
    let lastIndex = 0;
    let match;

    while ((match = urlRegex.exec(text)) !== null) {
      // Append escaped text before the match
      result += this.escapeHtml(text.substring(lastIndex, match.index));
      
      const url = match[0];
      const properUrl = url.startsWith('http') ? url : `https://${url}`;
      
      // Only create a link if the URL is valid
      if (this.isValidHttpUrl(properUrl)) {
        const linkHtml = `
          <a href="${properUrl}" 
             target="_blank" 
             rel="noopener noreferrer" 
             class="text-sky-400 hover:underline transition-colors">
            ${this.escapeHtml(properUrl)}
          </a>
        `;
        result += linkHtml.replace(/\s\s+/g, ' ').trim();
      } else {
        // If not a valid URL (e.g., malformed), just display the raw (escaped) text
        result += this.escapeHtml(url);
      }
      lastIndex = match.index + url.length;
    }
    
    // Append the rest of the escaped text after the last match
    if (lastIndex < text.length) {
      result += this.escapeHtml(text.substring(lastIndex));
    }

    return this.sanitizer.bypassSecurityTrustHtml(result);
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
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
    const shareText = `Evo preporuke za piće: ${place.name}\nAdresa: ${place.address || 'Nije dostupna'}`;
    
    let urlToShare = window.location.href; // Default to current app URL

    if (navigator.share) {
      try {
        await navigator.share({
          title: `Preporuka: ${place.name}`,
          text: shareText,
          url: urlToShare
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

  async copyMessageContent(messageId: number): Promise<void> {
    const messageToCopy = this.messages().find(msg => msg.id === messageId);
    if (!messageToCopy) return;

    let contentToCopy = '';
    for (const part of messageToCopy.parts) {
      switch (part.type) {
        case 'text':
          contentToCopy += part.content + '\n\n';
          break;
        case 'locations':
          contentToCopy += `${part.title}:\n`;
          for (const place of part.places) {
            contentToCopy += `- ${place.name}`;
            if (place.rating) contentToCopy += ` Ocjena: ${place.rating} (${place.reviews} recenzija)`;
            if (place.distance) contentToCopy += ` Udaljenost: ${place.distance}`;
            contentToCopy += '\n';
            if (place.address) contentToCopy += `  Adresa: ${place.address}\n`;
            if (place.hours) contentToCopy += `  Radno vrijeme: ${place.hours}\n`;
            if (place.price) contentToCopy += `  Procjena cijene: ${place.price}\n`;
            if (place.quote) contentToCopy += `  "${place.quote}"\n`;
            contentToCopy += '\n';
          }
          break;
        case 'sources':
          contentToCopy += `Izvori:\n`;
          for (const source of part.sources) {
            contentToCopy += `- ${source.title || source.uri}: ${source.uri}\n`;
          }
          contentToCopy += '\n';
          break;
        case 'error':
          contentToCopy += `GREŠKA: ${part.message}\n\n`;
          break;
        // user-image parts are for user messages, not typically copied from model.
      }
    }

    if (contentToCopy.trim()) {
      try {
        await navigator.clipboard.writeText(contentToCopy.trim());
        this.copiedMessageId.set(messageId);
        setTimeout(() => this.copiedMessageId.set(null), 2000);
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