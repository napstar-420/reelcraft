import { boolean, pgTable, text, timestamptz } from './pg-helpers';

/** Settings made in the app (Settings page). Secret values are encrypted
 * by `SettingsCipher`; the table holds nothing that can be read without it. */
export const appSetting = pgTable('app_setting', {
  key: text('key').primaryKey(), // setting name, e.g. providerKey.openrouter
  value: text('value').notNull(), // ciphertext when secret, else the plain value
  secret: boolean('secret').notNull(), // whether value is encrypted
  updatedAt: timestamptz('updated_at').notNull().defaultNow(), // last change
});
