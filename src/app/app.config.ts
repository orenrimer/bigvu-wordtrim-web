import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideAnimations } from '@angular/platform-browser/animations';

import { routes } from './app.routes';

/**
 * Application configuration for standalone components
 * Provides global services and configurations
 */
export const appConfig: ApplicationConfig = {
  providers: [
    // Enable zone-based change detection with event coalescing for better performance
    provideZoneChangeDetection({ eventCoalescing: true }),

    // Configure routing
    provideRouter(routes),

    // Enable HTTP client with fetch API for better performance
    // Required for SegmentationLoaderService to fetch JSON data
    provideHttpClient(withFetch()),

    // Enable animations for smooth UI transitions
    provideAnimations()
  ]
};
