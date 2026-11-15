# Voice typing and picture-led choices

For people who find speaking or tapping pictures easier than typing.

## Voice typing
- A microphone button appears next to the job search box, the profile headline and biography, the message to an employer when applying, and the job title and description when posting a job. Tap it, speak, and the words are added to the field; tap the square to stop. It is built into `TextField` / `TextAreaField` as `voice`, so any other field can get it with one word.
- It uses the browser's own speech recognition (Web Speech API). **Where the browser has none (Firefox, some phones) the button is not shown.** In Chrome and Edge the audio is sent to the browser vendor's speech service, not to this platform, and it needs an internet connection and microphone permission.
- The language follows the interface language: English `en-US`, Amharic `am-ET`, Afaan Oromoo `om-ET`. Amharic works in Chrome; **Afaan Oromoo is not supported by most browsers**, in which case the user is told so and asked to switch to Amharic or English.
- Plain-language messages for a blocked microphone, no speech heard, no microphone, no network, unsupported language.

## Picture-led choices
- **Jobs page:** large icon tiles for the kind of work (12 shown, "Show all" for the rest). One tap filters; tap again to clear.
- **Sign-up:** two large cards, "Job seeker" (search icon) and "Employer" (briefcase icon), instead of a drop-down.

## Honest limits
- Tested with a fake speech engine (`lib/speech.test.tsx`) and by loading the pages; **no real microphone or phone was used**, and recognition accuracy for Amharic was not measured.
- Not built: spoken (text-to-speech) reading of pages, a voice-only job search flow, and icons for every filter.
