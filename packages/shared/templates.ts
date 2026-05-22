// Slide layout template definitions for pptxgenjs
// These define the 5 core layouts used in template-first generation

export interface SlideTemplate {
  name: string;
  background: { color: string };
  titleConfig: {
    x: number; y: number; w: number; h: number;
    fontSize: number; color: string; bold: boolean;
    align: 'left' | 'center' | 'right';
  };
  bodyConfig?: {
    x: number; y: number; w: number; h: number;
    fontSize: number; color: string;
    align: 'left' | 'center' | 'right';
    lineSpacing?: number;
  };
  bulletConfig?: {
    x: number; y: number; w: number; h: number;
    fontSize: number; color: string;
    bulletType?: string;
    lineSpacing?: number;
  };
  leftPanelConfig?: {
    x: number; y: number; w: number; h: number;
    fontSize: number; color: string;
  };
  rightPanelConfig?: {
    x: number; y: number; w: number; h: number;
    fontSize: number; color: string;
  };
  noteConfig?: {
    fontSize: number; color: string;
  };
}

// Color palette — professional, CBSE-appropriate
const COLORS = {
  darkBg: '1a1a2e',
  mediumBg: '16213e',
  lightBg: 'f0f0f5',
  accent: '4e30a5',       // Savra brand purple
  accentLight: 'c7afff',
  white: 'ffffff',
  darkText: '1f2937',
  lightText: 'e2e8f0',
  subtitle: '94a3b8',
  highlight: '22d3ee',
};

export const SLIDE_TEMPLATES: Record<string, SlideTemplate> = {
  'title': {
    name: 'Title Slide',
    background: { color: COLORS.darkBg },
    titleConfig: {
      x: 0.8, y: 1.5, w: 8.4, h: 1.5,
      fontSize: 36, color: COLORS.white, bold: true, align: 'center',
    },
    bodyConfig: {
      x: 1.5, y: 3.2, w: 7, h: 1,
      fontSize: 18, color: COLORS.accentLight, align: 'center',
    },
    noteConfig: { fontSize: 12, color: COLORS.subtitle },
  },

  'bullet-list': {
    name: 'Bullet List',
    background: { color: COLORS.lightBg },
    titleConfig: {
      x: 0.6, y: 0.3, w: 8.8, h: 0.8,
      fontSize: 28, color: COLORS.darkText, bold: true, align: 'left',
    },
    bulletConfig: {
      x: 0.8, y: 1.4, w: 8.4, h: 4,
      fontSize: 18, color: COLORS.darkText, lineSpacing: 32,
    },
    noteConfig: { fontSize: 12, color: COLORS.subtitle },
  },

  'two-column': {
    name: 'Two Column',
    background: { color: COLORS.lightBg },
    titleConfig: {
      x: 0.6, y: 0.3, w: 8.8, h: 0.8,
      fontSize: 28, color: COLORS.darkText, bold: true, align: 'center',
    },
    leftPanelConfig: {
      x: 0.5, y: 1.4, w: 4.2, h: 3.8,
      fontSize: 16, color: COLORS.darkText,
    },
    rightPanelConfig: {
      x: 5.3, y: 1.4, w: 4.2, h: 3.8,
      fontSize: 16, color: COLORS.darkText,
    },
    noteConfig: { fontSize: 12, color: COLORS.subtitle },
  },

  'content-with-image': {
    name: 'Content with Image Placeholder',
    background: { color: COLORS.lightBg },
    titleConfig: {
      x: 0.6, y: 0.3, w: 8.8, h: 0.8,
      fontSize: 28, color: COLORS.darkText, bold: true, align: 'left',
    },
    bodyConfig: {
      x: 0.6, y: 1.4, w: 5.5, h: 3.8,
      fontSize: 16, color: COLORS.darkText, align: 'left', lineSpacing: 28,
    },
    rightPanelConfig: {
      x: 6.5, y: 1.4, w: 3, h: 3.8,
      fontSize: 14, color: COLORS.subtitle,
    },
    noteConfig: { fontSize: 12, color: COLORS.subtitle },
  },

  'quiz': {
    name: 'Quiz / MCQ',
    background: { color: COLORS.lightBg },
    titleConfig: {
      x: 0.6, y: 0.28, w: 8.8, h: 0.75,
      fontSize: 26, color: COLORS.darkText, bold: true, align: 'left',
    },
    noteConfig: { fontSize: 12, color: COLORS.subtitle },
  },

  'quote-or-definition': {
    name: 'Quote / Key Concept',
    background: { color: COLORS.mediumBg },
    titleConfig: {
      x: 0.8, y: 0.4, w: 8.4, h: 0.7,
      fontSize: 24, color: COLORS.highlight, bold: true, align: 'left',
    },
    bodyConfig: {
      x: 1.2, y: 1.8, w: 7.6, h: 3,
      fontSize: 22, color: COLORS.white, align: 'center', lineSpacing: 36,
    },
    noteConfig: { fontSize: 12, color: COLORS.subtitle },
  },
};

export { COLORS };
