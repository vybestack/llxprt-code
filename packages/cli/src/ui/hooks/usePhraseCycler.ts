/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef } from 'react';

export const WITTY_LOADING_PHRASES = [
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
];

export const PHRASE_CHANGE_INTERVAL_MS = 15000; // 15 seconds between phrase changes

/**
 * Custom hook to manage cycling through loading phrases.
 * @param isActive Whether the phrase cycling should be active.
 * @param isWaiting Whether to show a specific waiting phrase.
 * @returns The current loading phrase.
 */
export const usePhraseCycler = (isActive: boolean, isWaiting: boolean) => {
  const [currentLoadingPhrase, setCurrentLoadingPhrase] = useState(
    WITTY_LOADING_PHRASES[0],
  );
  const phraseIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (isWaiting) {
      setCurrentLoadingPhrase('Waiting for user confirmation...');
      if (phraseIntervalRef.current) {
        clearInterval(phraseIntervalRef.current);
        phraseIntervalRef.current = null;
      }
    } else if (isActive) {
      if (phraseIntervalRef.current) {
        clearInterval(phraseIntervalRef.current);
      }
      // Select an initial random phrase
      const initialRandomIndex = Math.floor(
        Math.random() * WITTY_LOADING_PHRASES.length,
      );
      setCurrentLoadingPhrase(WITTY_LOADING_PHRASES[initialRandomIndex]);

      phraseIntervalRef.current = setInterval(() => {
        setCurrentLoadingPhrase((prevPhrase) => {
          // Pick a new phrase that is different from the previous one (when possible)
          let nextPhrase = prevPhrase;
          if (WITTY_LOADING_PHRASES.length > 1) {
            do {
              const randomIndex = Math.floor(
                Math.random() * WITTY_LOADING_PHRASES.length,
              );
              nextPhrase = WITTY_LOADING_PHRASES[randomIndex];
            } while (nextPhrase === prevPhrase);
          }
          return nextPhrase;
        });
      }, PHRASE_CHANGE_INTERVAL_MS);
    } else {
      // Idle or other states, clear the phrase interval
      // and reset to the first phrase for next active state.
      if (phraseIntervalRef.current) {
        clearInterval(phraseIntervalRef.current);
        phraseIntervalRef.current = null;
      }
      setCurrentLoadingPhrase(WITTY_LOADING_PHRASES[0]);
    }

    return () => {
      if (phraseIntervalRef.current) {
        clearInterval(phraseIntervalRef.current);
        phraseIntervalRef.current = null;
      }
    };
  }, [isActive, isWaiting]);

  return currentLoadingPhrase;
};
