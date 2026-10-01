/**
 * Auth validation and bilingual (English / Hindi) messages.
 * Imported by the AuthCard in the browser and by the Server Actions, so both
 * sides apply exactly the same rules and show exactly the same words.
 */
export const MIN_PASSCODE_LENGTH = 8;

export type AuthErrorCode =
  | 'invalid_credentials'
  | 'email_invalid'
  | 'passcode_short'
  | 'name_required'
  | 'phone_invalid'
  | 'city_required'
  | 'vehicle_required'
  | 'vehicle_number_invalid'
  | 'email_taken'
  | 'vehicle_taken'
  | 'email_not_confirmed'
  | 'wrong_portal_is_driver'
  | 'wrong_portal_is_client'
  | 'wrong_portal'
  | 'profile_missing'
  | 'rate_limited'
  | 'not_configured'
  | 'generic';

export const AUTH_MESSAGES: Record<AuthErrorCode, { en: string; hi: string }> = {
  invalid_credentials: { en: 'Invalid credentials', hi: 'गलत क्रेडेंशियल्स' },
  email_invalid: { en: 'Enter a valid email address', hi: 'सही ईमेल पता लिखें' },
  passcode_short: {
    en: `Passcode must be at least ${MIN_PASSCODE_LENGTH} characters`,
    hi: `पासकोड कम से कम ${MIN_PASSCODE_LENGTH} अक्षरों का होना चाहिए`,
  },
  name_required: { en: 'Enter your name', hi: 'अपना नाम लिखें' },
  phone_invalid: { en: 'Enter a 10-digit mobile number', hi: '10 अंकों का मोबाइल नंबर लिखें' },
  city_required: { en: 'Choose your city', hi: 'अपना शहर चुनें' },
  vehicle_required: { en: 'Choose your vehicle', hi: 'अपना वाहन चुनें' },
  vehicle_number_invalid: { en: 'Enter the number as on the plate, e.g. MH 12 AB 1234', hi: 'नंबर प्लेट जैसा नंबर लिखें, जैसे MH 12 AB 1234' },
  email_taken: { en: 'This email is already registered. Log in instead', hi: 'यह ईमेल पहले से पंजीकृत है। लॉग इन करें' },
  vehicle_taken: { en: 'This vehicle number is already registered', hi: 'यह वाहन नंबर पहले से पंजीकृत है' },
  email_not_confirmed: { en: 'Confirm your email first, then log in', hi: 'पहले ईमेल की पुष्टि करें, फिर लॉग इन करें' },
  wrong_portal_is_driver: {
    en: 'This is a driver account. Use the Fleet Partner portal',
    hi: 'यह ड्राइवर खाता है। फ्लीट पार्टनर पोर्टल से लॉग इन करें',
  },
  wrong_portal_is_client: {
    en: 'This is a client account. Use the Ship Cargo portal',
    hi: 'यह ग्राहक खाता है। शिप कार्गो पोर्टल से लॉग इन करें',
  },
  wrong_portal: { en: 'This account cannot open this portal', hi: 'यह खाता इस पोर्टल को नहीं खोल सकता' },
  profile_missing: {
    en: 'Your account has no profile yet. Please contact support',
    hi: 'आपके खाते की प्रोफ़ाइल नहीं बनी है। कृपया सहायता से संपर्क करें',
  },
  rate_limited: { en: 'Too many attempts. Wait a minute and try again', hi: 'बहुत अधिक प्रयास। एक मिनट बाद फिर कोशिश करें' },
  not_configured: { en: 'Sign-in is not set up yet', hi: 'साइन-इन अभी सेट नहीं है' },
  generic: { en: 'Something went wrong. Please try again', hi: 'कुछ गड़बड़ हुई। फिर से कोशिश करें' },
};

/** "English / हिंदी", the format used for every auth error on screen. */
export const bilingual = (code: AuthErrorCode) => `${AUTH_MESSAGES[code].en} / ${AUTH_MESSAGES[code].hi}`;

export const isAuthErrorCode = (value: string | undefined | null): value is AuthErrorCode =>
  Boolean(value) && Object.prototype.hasOwnProperty.call(AUTH_MESSAGES, value as string);

export const AUTH_SUCCESS = {
  confirm_email: {
    en: 'Account created. Open the link we emailed you, then log in',
    hi: 'खाता बन गया। ईमेल में भेजा गया लिंक खोलें, फिर लॉग इन करें',
  },
};

// ---------------------------------------------------------------------------
// Validators: each returns an error code, or null when the value is fine.
// ---------------------------------------------------------------------------
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const cleanEmail = (value: string) => value.trim().toLowerCase();
/** Digits only, without a leading +91 / 0, so "+91 98200 11001" and "9820011001" are the same number. */
export const cleanPhone = (value: string) => value.replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '');
export const cleanVehicleNumber = (value: string) => value.trim().toUpperCase().replace(/\s+/g, ' ');

export function checkEmail(value: string): AuthErrorCode | null {
  return EMAIL.test(cleanEmail(value)) && value.trim().length <= 254 ? null : 'email_invalid';
}

export function checkPasscode(value: string): AuthErrorCode | null {
  return value.length >= MIN_PASSCODE_LENGTH && value.length <= 72 ? null : 'passcode_short';
}

export function checkName(value: string): AuthErrorCode | null {
  const v = value.trim();
  return v.length >= 2 && v.length <= 80 ? null : 'name_required';
}

export function checkPhone(value: string): AuthErrorCode | null {
  return /^[6-9]\d{9}$/.test(cleanPhone(value)) ? null : 'phone_invalid';
}

/** Optional field: blank is fine, otherwise it must look like an Indian registration plate. */
export function checkVehicleNumber(value: string): AuthErrorCode | null {
  const v = cleanVehicleNumber(value).replace(/[ -]/g, '');
  if (v === '') return null;
  // State series (MH 12 AB 1234, DL 1L AB 6042) or the all-India BH series (22 BH 1234 AA).
  return /^[A-Z]{2}\d{1,2}[A-Z]{0,4}\d{3,4}$/.test(v) || /^\d{2}BH\d{4}[A-Z]{1,2}$/.test(v) ? null : 'vehicle_number_invalid';
}

export type ClientType = 'individual' | 'company';
export type DriverType = 'gig' | 'full_time';

export type AuthField = 'email' | 'passcode' | 'full_name' | 'phone' | 'city' | 'vehicle_type' | 'vehicle_number';
export type FieldErrors = Partial<Record<AuthField, AuthErrorCode>>;

/** Result of the sign-in / sign-up Server Actions. On success they redirect instead of returning. */
export type AuthResult = {
  ok: boolean;
  error?: AuthErrorCode;
  fieldErrors?: FieldErrors;
  /** Sign-up succeeded but the project requires email confirmation before the first login. */
  confirmEmail?: boolean;
};
