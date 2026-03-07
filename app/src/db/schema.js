import { pgTable, serial, text, varchar, integer, decimal, timestamp, pgEnum } from 'drizzle-orm/pg-core';

// Enums
export const kycStatusEnum = pgEnum('kyc_status', ['none', 'pending', 'verified']);
export const planEnum = pgEnum('plan', ['free', 'seller_pro', 'business']);
export const conditionEnum = pgEnum('condition', ['new', 'like_new', 'good', 'fair']);
export const listingTypeEnum = pgEnum('listing_type', ['sell', 'swap', 'both']);
export const listingStatusEnum = pgEnum('listing_status', ['active', 'sold', 'swapped', 'expired']);
export const offerTypeEnum = pgEnum('offer_type', ['cash', 'swap', 'swap_cash']);
export const offerStatusEnum = pgEnum('offer_status', ['pending', 'accepted', 'rejected', 'completed']);
export const txStatusEnum = pgEnum('tx_status', ['pending', 'completed', 'refunded']);

// Tables
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  password_hash: text('password_hash').notNull(),
  username: varchar('username', { length: 100 }).notNull().unique(),
  name: varchar('name', { length: 255 }),
  bio: text('bio'),
  location: varchar('location', { length: 255 }),
  kyc_status: text('kyc_status').default('none').notNull(),
  reputation_score: integer('reputation_score').default(0).notNull(),
  plan: text('plan').default('free').notNull(),
  avatar_path: text('avatar_path'),
  created_at: timestamp('created_at').defaultNow().notNull(),
});

export const categories = pgTable('categories', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  slug: varchar('slug', { length: 100 }).notNull().unique(),
  icon: varchar('icon', { length: 50 }),
  parent_id: integer('parent_id'),
});

export const listings = pgTable('listings', {
  id: serial('id').primaryKey(),
  seller_id: integer('seller_id').notNull(),
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description'),
  price: decimal('price', { precision: 12, scale: 2 }),
  currency: varchar('currency', { length: 10 }).default('CHF').notNull(),
  category_id: integer('category_id').notNull(),
  condition: text('condition').notNull(),
  location: varchar('location', { length: 255 }),
  type: text('type').notNull(),
  status: text('status').default('active').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
});

export const listingImages = pgTable('listing_images', {
  id: serial('id').primaryKey(),
  listing_id: integer('listing_id').notNull(),
  file_path: text('file_path').notNull(),
  position: integer('position').default(0).notNull(),
});

export const offers = pgTable('offers', {
  id: serial('id').primaryKey(),
  listing_id: integer('listing_id').notNull(),
  buyer_id: integer('buyer_id').notNull(),
  type: text('type').notNull(),
  cash_amount: decimal('cash_amount', { precision: 12, scale: 2 }),
  swap_listing_id: integer('swap_listing_id'),
  message: text('message'),
  status: text('status').default('pending').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
});

export const messages = pgTable('messages', {
  id: serial('id').primaryKey(),
  offer_id: integer('offer_id').notNull(),
  sender_id: integer('sender_id').notNull(),
  content: text('content').notNull(),
  read_at: timestamp('read_at'),
  created_at: timestamp('created_at').defaultNow().notNull(),
});

export const transactions = pgTable('transactions', {
  id: serial('id').primaryKey(),
  offer_id: integer('offer_id').notNull(),
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
  commission: decimal('commission', { precision: 12, scale: 2 }).notNull(),
  commission_rate: decimal('commission_rate', { precision: 5, scale: 4 }).notNull(),
  status: text('status').default('pending').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
});

export const reviews = pgTable('reviews', {
  id: serial('id').primaryKey(),
  transaction_id: integer('transaction_id').notNull(),
  reviewer_id: integer('reviewer_id').notNull(),
  reviewee_id: integer('reviewee_id').notNull(),
  rating: integer('rating').notNull(),
  comment: text('comment'),
  created_at: timestamp('created_at').defaultNow().notNull(),
});
