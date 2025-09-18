/**
 * @license
 * Copyright 2025 Vybestack LLC
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

export const PHRASE_CHANGE_INTERVAL_MS = 15000; // 15 seconds between phrase changes

/**
 * Custom hook to manage cycling through loading phrases.
 * @param isActive Whether the phrase cycling should be active.
 * @param isWaiting Whether to show a specific waiting phrase.
 * @returns The current loading phrase.
 */
export const usePhraseCycler = (
  isActive: boolean,
  isWaiting: boolean,
  customPhrases?: string[],
) => {
  const loadingPhrases =
    customPhrases && customPhrases.length > 0
      ? customPhrases
      : WITTY_LOADING_PHRASES;

  const [currentLoadingPhrase, setCurrentLoadingPhrase] = useState(
    loadingPhrases[0],
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
        Math.random() * loadingPhrases.length,
      );
      setCurrentLoadingPhrase(loadingPhrases[initialRandomIndex]);

      phraseIntervalRef.current = setInterval(() => {
        // Select a new random phrase
        const randomIndex = Math.floor(Math.random() * loadingPhrases.length);
        setCurrentLoadingPhrase(loadingPhrases[randomIndex]);
      }, PHRASE_CHANGE_INTERVAL_MS);
    } else {
      // Idle or other states, clear the phrase interval
      // and reset to the first phrase for next active state.
      if (phraseIntervalRef.current) {
        clearInterval(phraseIntervalRef.current);
        phraseIntervalRef.current = null;
      }
      setCurrentLoadingPhrase(loadingPhrases[0]);
    }

    return () => {
      if (phraseIntervalRef.current) {
        clearInterval(phraseIntervalRef.current);
        phraseIntervalRef.current = null;
      }
    };
  }, [isActive, isWaiting, loadingPhrases]);

  return currentLoadingPhrase;
};
