/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Available witty phrase style options
 */
export type WittyPhraseStyle =
  | 'default'
  | 'llxprt'
  | 'gemini-cli'
  | 'whimsical'
  | 'custom';

/**
 * LLxprt built-in phrases (current default)
 * Source: Fight Club, Salvador Dalí, Office Space, René Magritte, Marcel Duchamp, André Breton
 */
export const LLXPRT_PHRASES = [
  // Fight Club quotes
  'The first rule of Fight Club is: you do not talk about Fight Club.',
  'The second rule of Fight Club is: you do not talk about Fight Club.',
  "It's only after we've lost everything that we're free to do anything.",
  'The things you own end up owning you.',
  'Without pain, without sacrifice, we would have nothing.',
  'You are not a beautiful and unique snowflake. You are the same decaying organic matter as everyone else.',
  'Sticking feathers up your butt does not make you a chicken.',
  "We're consumers. We are the by-products of a lifestyle obsession.",
  'I want you to hit me as hard as you can.',
  'On a long enough timeline, the survival rate for everybody drops to zero.',
  "What...what if you're not absolutely right?",

  // Salvador Dalí quotes
  "Don't be afraid of perfection—you will never attain it.",
  "I don't do drugs. I am drugs.",
  'The sole difference between myself and a madman is the fact that I am not mad.',
  'It is not necessary for the public to know whether I am joking or whether I am serious, just as it is not necessary for me to know it myself.',
  'Mistakes are almost always of a sacred nature. Never try to correct them.',
  'Begin by drawing and painting like the old masters; after that, do as you see fit—you will always be respected.',
  'The difference between false memories and true ones is the same as for jewels: it is always the false ones that look the most real, the most brilliant.',
  'When you are a genius, you do not have the right to die, because we are necessary for the progress of humanity.',

  // Office Space quotes
  'Excuse me, I believe you have my stapler.',
  "If they take my stapler, then I'll set the building on fire.",
  'What would you say … you do here?',
  "Looks like somebody's got a case of the Mondays.",
  'Did you get the memo about the TPS reports?',
  "It's not that I'm lazy—it's that I just don't care.",

  // René Magritte quotes
  'An object is not so attached to its name that we cannot find another one that would suit it better.',
  'If the dream is a translation of waking life, waking life is also a translation of the dream.',
  'Art evokes the mystery without which the world would not exist',
  'This is not a pipe.',
  'We must not fear daylight just because it almost always illuminates a miserable world.',

  // More Salvador Dalí quotes
  'I am not strange. I am just not normal.',
  'Take me, I am the drug; take me, I am hallucinogenic',

  // Marcel Duchamp quotes
  'I force myself to contradict myself in order to avoid conforming to my own taste.',

  // André Breton quotes
  'It is living and ceasing to live that are imaginary solutions. Existence is elsewhere.',
];

/**
 * Gemini-CLI phrases (migrated from original gemini-cli)
 * Source: https://github.com/e2720pjk/gemini-cli/blob/main/packages/cli/src/ui/constants/wittyPhrases.ts
 */
export const GEMINI_CLI_PHRASES = [
  "I'm Feeling Lucky",
  'Shipping awesomeness... ',
  'Painting the serifs back on...',
  'Navigating the slime mold...',
  'Consulting the digital spirits...',
  'Reticulating splines...',
  'Warming up the AI hamsters...',
  'Asking the magic conch shell...',
  'Generating witty retort...',
  'Polishing the algorithms...',
  "Don't rush perfection (or my code)...",
  'Brewing fresh bytes...',
  'Counting electrons...',
  'Engaging cognitive processors...',
  'Checking for syntax errors in the universe...',
  'One moment, optimizing humor...',
  'Shuffling punchlines...',
  'Untangling neural nets...',
  'Compiling brilliance...',
  'Loading wit.exe...',
  'Summoning the cloud of wisdom...',
  'Preparing a witty response...',
  "Just a sec, I'm debugging reality...",
  'Confuzzling the options...',
  'Tuning the cosmic frequencies...',
  'Crafting a response worthy of your patience...',
  'Compiling the 1s and 0s...',
  'Resolving dependencies... and existential crises...',
  'Defragmenting memories... both RAM and personal...',
  'Rebooting the humor module...',
  'Caching the essentials (mostly cat memes)...',
  'Optimizing for ludicrous speed',
  "Swapping bits... don't tell the bytes...",
  'Garbage collecting... be right back...',
  'Assembling the interwebs...',
  'Converting coffee into code...',
  'Updating the syntax for reality...',
  'Rewiring the synapses...',
  'Looking for a misplaced semicolon...',
  "Greasin' the cogs of the machine...",
  'Pre-heating the servers...',
  'Calibrating the flux capacitor...',
  'Engaging the improbability drive...',
  'Channeling the Force...',
  'Aligning the stars for optimal response...',
  'So say we all...',
  'Loading the next great idea...',
  "Just a moment, I'm in the zone...",
  'Preparing to dazzle you with brilliance...',
  "Just a tick, I'm polishing my wit...",
  "Hold tight, I'm crafting a masterpiece...",
  "Just a jiffy, I'm debugging the universe...",
  "Just a moment, I'm aligning the pixels...",
  "Just a sec, I'm optimizing the humor...",
  "Just a moment, I'm tuning the algorithms...",
  'Warp speed engaged...',
  'Mining for more Dilithium crystals...',
  "Don't panic...",
  'Following the white rabbit...',
  'The truth is in here... somewhere...',
  'Blowing on the cartridge...',
  'Loading... Do a barrel roll!',
  'Waiting for the respawn...',
  'Finishing the Kessel Run in less than 12 parsecs...',
  "The cake is not a lie, it's just still loading...",
  'Fiddling with the character creation screen...',
  "Just a moment, I'm finding the right meme...",
  "Pressing 'A' to continue...",
  'Herding digital cats...',
  'Polishing the pixels...',
  'Finding a suitable loading screen pun...',
  'Distracting you with this witty phrase...',
  'Almost there... probably...',
  'Our hamsters are working as fast as they can...',
  'Giving Cloudy a pat on the head...',
  'Petting the cat...',
  'Rickrolling my boss...',
  'Slapping the bass...',
  'Tasting the snozberries...',
  "I'm going the distance, I'm going for speed...",
  'Is this the real life? Is this just fantasy?...',
  "I've got a good feeling about this...",
  'Poking the bear...',
  'Doing research on the latest memes...',
  'Figuring out how to make this more witty...',
  'Hmmm... let me think...',
  'What do you call a fish with no eyes? A fsh...',
  'Why did the computer go to therapy? It had too many bytes...',
  "Why don't programmers like nature? It has too many bugs...",
  'Why do programmers prefer dark mode? Because light attracts bugs...',
  'Why did the developer go broke? Because they used up all their cache...',
  "What can you do with a broken pencil? Nothing, it's pointless...",
  'Applying percussive maintenance...',
  'Searching for the correct USB orientation...',
  'Ensuring the magic smoke stays inside the wires...',
  'Rewriting in Rust for no particular reason...',
  'Trying to exit Vim...',
  'Spinning up the hamster wheel...',
  "That's not a bug, it's an undocumented feature...",
  'Engage.',
  "I'll be back... with an answer.",
  'My other process is a TARDIS...',
  'Communing with the machine spirit...',
  'Letting the thoughts marinate...',
  'Just remembered where I put my keys...',
  'Pondering the orb...',
  "I've seen things you people wouldn't believe... like a user who reads loading messages.",
  'Initiating thoughtful gaze...',
  "What's a computer's favorite snack? Microchips.",
  "Why do Java developers wear glasses? Because they don't C#.",
  'Charging the laser... pew pew!',
  'Dividing by zero... just kidding!',
  'Looking for an adult superviso... I mean, processing.',
  'Making it go beep boop.',
  'Buffering... because even AIs need a moment.',
  'Entangling quantum particles for a faster response...',
  'Polishing the chrome... on the algorithms.',
  'Are you not entertained? (Working on it!)',
  'Summoning the code gremlins... to help, of course.',
  'Just waiting for the dial-up tone to finish...',
  'Recalibrating the humor-o-meter.',
  'My other loading screen is even funnier.',
  "Pretty sure there's a cat walking on the keyboard somewhere...",
  'Enhancing... Enhancing... Still loading.',
  "It's not a bug, it's a feature... of this loading screen.",
  'Have you tried turning it off and on again? (The loading screen, not me.)',
  'Constructing additional pylons...',
  "New line? That's Ctrl+J.",
  'Releasing the HypnoDrones...',
];

/**
 * Whimsical phrases (My Little Pony themed)
 */
export const COMMUNITY_PHRASES = [
  'The first rule of the Friendship Circle is: We all talk about our feelings.',
  "You are not your Cutie Mark. You're not how much Glitter Glue you have in your cupboard.",
  "This is your day, and it's starting with a Hug-A-Gram one minute at a time.",
  "It's only after we've lost Grumpy Bear's giggle that we're free to show how much we truly care.",
];

/**
 * Selects phrase collection based on style setting
 * @param style The witty phrase style setting
 * @param customPhrases Optional user-defined custom phrases
 * @returns Array of phrases to use for cycling
 */
export function getPhraseCollection(
  style: WittyPhraseStyle,
  customPhrases?: string[],
): string[] {
  switch (style) {
    case 'llxprt':
      return LLXPRT_PHRASES;
    case 'gemini-cli':
      return GEMINI_CLI_PHRASES;
    case 'whimsical':
      return COMMUNITY_PHRASES;
    case 'custom':
      return customPhrases && customPhrases.length > 0
        ? customPhrases
        : LLXPRT_PHRASES; // Fallback to built-in if custom is empty
    case 'default':
    default:
      // Default: LLxprt + custom override (current behavior)
      return customPhrases && customPhrases.length > 0
        ? customPhrases
        : LLXPRT_PHRASES;
  }
}
