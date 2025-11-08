import { Routes } from '@angular/router';
import { MainEditorContainerComponent } from './components/main-editor-container/main-editor-container.component';

/**
 * Application routes
 * Main route points to the Wordtrim editor container
 */
export const routes: Routes = [
    {
        path: '',
        component: MainEditorContainerComponent,
        title: 'Wordtrim - Word-Based Video Editor'
    },
    {
        path: '**',
        redirectTo: '',
        pathMatch: 'full'
    }
];
