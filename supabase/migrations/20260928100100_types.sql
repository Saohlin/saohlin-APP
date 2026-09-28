create type public.gender as enum ('female', 'male', 'other', 'unspecified');

create type public.zodiac_sign as enum (
  'aries', 'taurus', 'gemini', 'cancer', 'leo', 'virgo',
  'libra', 'scorpio', 'sagittarius', 'capricorn', 'aquarius', 'pisces'
);

-- terms/privacy: accepting the documents. ai_processing: AI coaching on the
-- user's data. special_category: health and belief information (GDPR Art. 9).
create type public.consent_kind as enum ('terms', 'privacy', 'ai_processing', 'special_category');
