import { Component, ChangeDetectionStrategy } from '@angular/core';
import { ChatComponent } from './components/chat/chat.component';

@Component({
  selector: 'app-root',
  // Fix: make component standalone
  standalone: true,
  templateUrl: './app.component.html',
  imports: [ChatComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent {}