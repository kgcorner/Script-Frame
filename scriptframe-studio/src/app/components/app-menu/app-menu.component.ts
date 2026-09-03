import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

interface MenuItem {
  label: string;
  route: string;
}

@Component({
  selector: 'app-app-menu',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './app-menu.component.html',
  styleUrl: './app-menu.component.scss',
})
export class AppMenuComponent {
  protected readonly menuItems: MenuItem[] = [
    { label: 'Workflow Editor', route: '/workflow' },
    { label: 'Create ComfyUI App', route: '/workflow-inputs' },
    { label: 'LLM App Config', route: '/llm-app-config' },
  ];
}