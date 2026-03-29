declare module 'arabic-persian-reshaper' {
  interface ShaperModule {
    convertArabic: (text: string) => string;
    convertArabicBack: (text: string) => string;
  }

  export const ArabicShaper: ShaperModule;
  export const PersianShaper: ShaperModule;
}
