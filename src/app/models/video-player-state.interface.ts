/**
 * Video Player State Interface
 * Represents the current state of the video player
 */
export interface VideoPlayerState {
    isPlaying: boolean;
    currentTime: number;
    duration: number;
    isLoading: boolean;
    error: string | null;
}

