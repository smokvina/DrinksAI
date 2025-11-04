import { ChangeDetectionStrategy, Component, ElementRef, ViewChild, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GeminiService } from '../../services/gemini.service';
import { ChatMessage, ChatPart, UserImagePart } from '../../models/app.models';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
<div class="flex flex-col h-screen bg-gray-100 font-sans">
  <header class="bg-white shadow-md p-4 border-b border-gray-200">
    <h1 class="text-2xl font-bold text-gray-800">Gdje na piće? 🍹</h1>
    <p class="text-sm text-gray-600">Pronađi najbolje mjesto za svoje omiljeno piće.</p>
  </header>

  <main #chatContainer class="flex-1 overflow-y-auto p-4 space-y-6">
    @for (message of messages(); track message.id) {
      <div class="flex" [class.justify-end]="message.role === 'user'" [class.justify-start]="message.role === 'model'">
        <div class="max-w-3xl w-full">
          <div class="flex items-start gap-3" [class.flex-row-reverse]="message.role === 'user'">
            <div class="w-8 h-8 rounded-full flex items-center justify-center text-white shrink-0" [class.bg-blue-500]="message.role === 'user'" [class.bg-gray-700]="message.role === 'model'">
              {{ message.role === 'user' ? 'Vi' : '🤖' }}
            </div>
            <div class="flex-1 space-y-2">
              @for (part of message.parts; track $index) {
                @if (isTextPart(part)) {
                  <div class="px-4 py-3 rounded-lg"
                      [class.bg-blue-500]="message.role === 'user'"
                      [class.text-white]="message.role === 'user'"
                      [class.bg-white]="message.role === 'model'"
                      [class.text-gray-800]="message.role === 'model'"
                      [class.shadow-md]="message.role === 'model'">
                    <p class="whitespace-pre-wrap">{{ part.content }}</p>
                  </div>
                }
                @if (isUserImagePart(part)) {
                  <div class="mt-2">
                    <img [src]="part.url" alt="User upload" class="rounded-lg max-w-xs max-h-64 shadow-md">
                  </div>
                }
                @if (isLocationsPart(part)) {
                  <div class="mt-2 w-full">
                    <h2 class="text-xl font-semibold text-gray-800 mb-3">{{ part.title }}</h2>
                    <div class="grid grid-cols-1 gap-4">
                      @for (place of part.places; track place.name) {
                        <div class="bg-white p-4 rounded-lg shadow-md border border-gray-200 hover:shadow-lg transition-shadow">
                          <h3 class="font-bold text-lg text-gray-900">{{ place.name }}</h3>
                          <div class="flex items-center text-sm text-gray-600 my-1 flex-wrap">
                            @if (place.rating) {
                              <span class="flex items-center mr-3">
                                <span class="text-yellow-500 mr-1">★</span>
                                <span>{{ place.rating }} ({{ place.reviews }} recenzija)</span>
                              </span>
                            }
                            @if (place.distance) {
                              <span class="flex items-center">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                                <span>{{ place.distance }}</span>
                              </span>
                            }
                          </div>
                          @if (place.address) {
                            <p class="text-sm text-gray-500">{{ place.address }}</p>
                          }
                          @if (place.hours) {
                            <p class="text-sm text-gray-500 mt-1"><strong>Radno vrijeme:</strong> {{ place.hours }}</p>
                          }
                          @if (place.quote) {
                            <p class="text-sm text-gray-700 italic my-2 border-l-4 border-gray-300 pl-3">"{{ place.quote }}"</p>
                          }
                          @if (place.price) {
                            <p class="text-sm font-semibold text-gray-700 mt-1">Procjena cijene: {{ place.price }}</p>
                          }
                          @if (place.mapLink) {
                            <a [href]="place.mapLink" target="_blank" rel="noopener noreferrer" class="text-blue-600 hover:underline text-sm mt-2 inline-block font-medium">
                              Prikaži na karti →
                            </a>
                          }
                        </div>
                      }
                    </div>
                  </div>
                }
                @if (isErrorPart(part)) {
                  <div class="bg-red-100 border-l-4 border-red-500 text-red-700 p-4 rounded-lg shadow-md" role="alert">
                    <p class="font-bold">Greška</p>
                    <p>{{ part.message }}</p>
                  </div>
                }
              }
            </div>
          </div>
        </div>
      </div>
    }
    @if (isLoading() && !isModelStreaming()) {
      <div class="flex justify-start">
        <div class="max-w-3xl w-full">
          <div class="flex items-start gap-3">
             <div class="w-8 h-8 rounded-full flex items-center justify-center text-white bg-gray-700 shrink-0">🤖</div>
             <div class="bg-white text-gray-800 px-4 py-3 rounded-lg shadow-md">
                <div class="flex items-center space-x-2">
                    <div class="animate-pulse bg-gray-300 rounded-full w-2 h-2"></div>
                    <div class="animate-pulse bg-gray-300 rounded-full w-2 h-2" style="animation-delay: 0.2s;"></div>
                    <div class="animate-pulse bg-gray-300 rounded-full w-2 h-2" style="animation-delay: 0.4s;"></div>
                </div>
              </div>
          </div>
        </div>
      </div>
    }
  </main>

  <footer class="p-4 bg-white border-t border-gray-200">
    @if (userImage()) {
      <div class="mb-2 flex items-center p-2 bg-gray-100 rounded-lg max-w-fit">
        <img [src]="userImage()!.url" alt="Preview" class="w-12 h-12 object-cover rounded-md mr-3">
        <button (click)="removeImage()" class="text-red-500 hover:text-red-700 font-bold p-1 rounded-full hover:bg-red-100">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd" />
            </svg>
        </button>
      </div>
    }
    <div class="flex items-center bg-gray-100 rounded-full p-1">
      <textarea
        #userInputElement
        [(ngModel)]="userInput"
        (keydown.enter)="onSend(); $event.preventDefault()"
        (input)="autoResize(userInputElement)"
        placeholder="Unesite naziv pića..."
        class="flex-1 bg-transparent border-none focus:ring-0 resize-none p-2 text-gray-800"
        rows="1"></textarea>
      
      <label for="file-upload" class="cursor-pointer text-gray-500 hover:text-gray-700 p-2 rounded-full hover:bg-gray-200">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
        </svg>
      </label>
      <input id="file-upload" type="file" class="hidden" (change)="onFileSelected($event)" accept="image/*">
      
      <button (click)="onSend()" [disabled]="isLoading() || (!userInput().trim() && !userImage())"
              class="bg-blue-500 text-white rounded-full p-2 ml-2 disabled:bg-blue-300 hover:bg-blue-600 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" viewBox="0 0 24 24" fill="currentColor">
            <path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z" />
        </svg>
      </button>
    </div>
  </footer>
</div>
  `,
  styles: [`
    textarea {
        scrollbar-width: none; /* Firefox */
    }
    textarea::-webkit-scrollbar {
        display: none; /* Safari and Chrome */
    }
    .animate-pulse {
      animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
    }
    @keyframes pulse {
      50% {
        opacity: .5;
      }
    }
  `],
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
      parts: [{ type: 'text', content: 'Pozdrav! Kako vam mogu pomoći pronaći savršeno piće ili mjesto za izlazak?' }]
    }
  ]);
  isLoading = signal(false);

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

  async onSend(): Promise<void> {
    const text = this.userInput().trim();
    const image = this.userImage();
    
    if (!text && !image) return;

    const userParts: ChatPart[] = [];
    if (text) userParts.push({ type: 'text', content: text });
    if (image) userParts.push(image);
    this.messages.update(m => [...m, { id: Date.now(), role: 'user', parts: userParts }]);
    
    this.userInput.set('');
    this.userImage.set(undefined);
    this.isLoading.set(true);

    const modelMessageId = Date.now();
    this.messages.update(m => [...m, { id: modelMessageId, role: 'model', parts: [] }]);

    try {
      const imageBase64 = image?.url.split(',')[1];
      const stream = this.geminiService.generateResponseStream(text, imageBase64);
      
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
              { ...lastMsg, parts: [{ type: 'text', content: fullResponseText + '...' }] }
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
      else {
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
      reader.onload = (e: any) => this.userImage.set({ type: 'user-image', url: e.target.result });
      reader.readAsDataURL(file);
      input.value = '';
    }
  }

  removeImage(): void {
    this.userImage.set(undefined);
  }

  autoResize(element: HTMLTextAreaElement): void {
    element.style.height = 'auto';
    element.style.height = (element.scrollHeight) + 'px';
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
