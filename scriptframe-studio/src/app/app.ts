import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AppMenuComponent } from './components/app-menu/app-menu.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, AppMenuComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  protected readonly title = signal('ScriptFrame');
}
