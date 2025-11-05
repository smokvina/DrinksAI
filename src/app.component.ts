import { Component, ChangeDetectionStrategy, ViewChild } from '@angular/core';
import { ChatComponent } from './components/chat/chat.component';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  imports: [ChatComponent],
  // FIX: Corrected Change.OnPush to ChangeDetectionStrategy.OnPush
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    'class': 'h-full block'
  }
})
export class AppComponent {
  @ViewChild(ChatComponent) chatComponent!: ChatComponent;

  newChat(): void {
    this.chatComponent.resetChat();
  }
}
