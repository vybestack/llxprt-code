/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { type ColorsTheme, Theme } from './theme.js';

const greenScreenColors: ColorsTheme = {
  type: 'dark',
  Background: '#000000',
  Foreground: '#6a9955',
  LightBlue: '#6a9955',
  AccentBlue: '#6a9955',
  AccentPurple: '#6a9955',
  AccentCyan: '#6a9955',
  AccentGreen: '#00ff00',
  AccentYellow: '#6a9955',
  AccentRed: '#6a9955',
  DiffAdded: '#00ff00',
  DiffRemoved: '#6a9955',
  DiffAddedBackground: '#6a9955',
  DiffAddedForeground: '#000000',
  DiffRemovedBackground: '#6a9955',
  DiffRemovedForeground: '#000000',
  Comment: '#6a9955',
  DimComment: '#4a7035',
  Gray: '#6a9955',
  GradientColors: ['#00ff00', '#6a9955'],
};

export const GreenScreen: Theme = new Theme(
  'Green Screen',
  'dark',
  {
    hljs: {
      display: 'block',
      overflowX: 'auto',
      padding: '0.5em',
      background: greenScreenColors.Background,
      color: greenScreenColors.Foreground,
    },
    'hljs-keyword': {
      color: greenScreenColors.Foreground,
      fontWeight: 'bold',
    },
    'hljs-selector-tag': {
      color: greenScreenColors.Foreground,
      fontWeight: 'bold',
    },
    'hljs-literal': {
      color: greenScreenColors.Foreground,
      fontWeight: 'bold',
    },
    'hljs-section': {
      color: greenScreenColors.Foreground,
      fontWeight: 'bold',
    },
    'hljs-link': {
      color: greenScreenColors.Foreground,
    },
    'hljs-function .hljs-keyword': {
      color: greenScreenColors.Foreground,
    },
    'hljs-subst': {
      color: greenScreenColors.Foreground,
    },
    'hljs-string': {
      color: greenScreenColors.Foreground,
    },
    'hljs-title': {
      color: greenScreenColors.Foreground,
      fontWeight: 'bold',
    },
    'hljs-name': {
      color: greenScreenColors.Foreground,
      fontWeight: 'bold',
    },
    'hljs-type': {
      color: greenScreenColors.Foreground,
      fontWeight: 'bold',
    },
    'hljs-attribute': {
      color: greenScreenColors.Foreground,
    },
    'hljs-symbol': {
      color: greenScreenColors.Foreground,
    },
    'hljs-bullet': {
      color: greenScreenColors.Foreground,
    },
    'hljs-addition': {
      color: greenScreenColors.Foreground,
    },
    'hljs-variable': {
      color: greenScreenColors.Foreground,
    },
    'hljs-template-tag': {
      color: greenScreenColors.Foreground,
    },
    'hljs-template-variable': {
      color: greenScreenColors.Foreground,
    },
    'hljs-comment': {
      color: greenScreenColors.Comment,
    },
    'hljs-quote': {
      color: greenScreenColors.Comment,
    },
    'hljs-deletion': {
      color: greenScreenColors.Foreground,
    },
    'hljs-meta': {
      color: greenScreenColors.Comment,
    },
    'hljs-doctag': {
      fontWeight: 'bold',
    },
    'hljs-strong': {
      fontWeight: 'bold',
    },
    'hljs-emphasis': {
      fontStyle: 'italic',
    },
  },
  greenScreenColors,
);
