import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

/**
 * Root Application Component
 * Contains only the router outlet to display routed components
 */
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  title = 'Wordtrim Web - Word-Based Video Editor';
}
