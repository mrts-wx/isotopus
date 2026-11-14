// Transformers.js imports its image helpers even when the app only uses audio.
// Avoid loading native libvips inside Electron; image processing is not used here.
export default function unsupportedImageProcessing() {
  throw new Error('Image processing is unavailable in the Isótopus desktop transcription runtime.');
}
