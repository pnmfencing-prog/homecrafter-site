-- HomeCrafter Database Schema

-- Contractors (from our scraped data)
CREATE TABLE IF NOT EXISTS contractors (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  phone VARCHAR(50),
  email VARCHAR(255),
  website VARCHAR(500),
  address VARCHAR(500),
  zip VARCHAR(10),
  lat DECIMAL(10,7),
  lng DECIMAL(10,7),
  category VARCHAR(50) NOT NULL,
  rating DECIMAL(3,1),
  reviews INTEGER DEFAULT 0,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Pro accounts (contractors who signed up)
CREATE TABLE IF NOT EXISTS pro_accounts (
  id SERIAL PRIMARY KEY,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  company VARCHAR(255),
  email VARCHAR(255) UNIQUE NOT NULL,
  phone VARCHAR(50),
  password_hash VARCHAR(255) NOT NULL,
  service VARCHAR(50),
  zip VARCHAR(10),
  status VARCHAR(20) DEFAULT 'pending',  -- pending, active, suspended
  created_at TIMESTAMP DEFAULT NOW()
);

-- Lead submissions (homeowner requests)
CREATE TABLE IF NOT EXISTS leads (
  id SERIAL PRIMARY KEY,
  homeowner_name VARCHAR(255),
  homeowner_email VARCHAR(255),
  homeowner_phone VARCHAR(50),
  address VARCHAR(500),
  zip VARCHAR(10),
  services TEXT[],
  notes TEXT,
  status VARCHAR(20) DEFAULT 'new',  -- new, matched, accepted, completed
  submitted_at TIMESTAMP DEFAULT NOW()
);

-- Lead assignments (which contractors got which leads)
CREATE TABLE IF NOT EXISTS lead_assignments (
  id SERIAL PRIMARY KEY,
  lead_id INTEGER REFERENCES leads(id),
  contractor_id INTEGER REFERENCES contractors(id),
  pro_account_id INTEGER REFERENCES pro_accounts(id),
  status VARCHAR(20) DEFAULT 'sent',  -- sent, viewed, accepted, declined
  sent_at TIMESTAMP DEFAULT NOW(),
  viewed_at TIMESTAMP,
  responded_at TIMESTAMP
);

-- Lead credits (purchased bundles)
CREATE TABLE IF NOT EXISTS lead_credits (
  id SERIAL PRIMARY KEY,
  pro_account_id INTEGER REFERENCES pro_accounts(id),
  category VARCHAR(50) NOT NULL,
  credits_total INTEGER NOT NULL,
  credits_used INTEGER DEFAULT 0,
  purchase_type VARCHAR(20),  -- alacarte, bundle_10, bundle_25, bundle_50
  stripe_payment_id VARCHAR(255),
  purchased_at TIMESTAMP DEFAULT NOW()
);

-- AI onboarding submissions
CREATE TABLE IF NOT EXISTS ai_onboard (
  id SERIAL PRIMARY KEY,
  business_name VARCHAR(255),
  owner_name VARCHAR(255),
  phone VARCHAR(50),
  email VARCHAR(255),
  services TEXT,
  service_area VARCHAR(255),
  pricing VARCHAR(255),
  hours VARCHAR(255),
  website VARCHAR(500),
  challenge TEXT,
  plan VARCHAR(50),
  submitted_at TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_contractors_zip ON contractors(zip);
CREATE INDEX IF NOT EXISTS idx_contractors_category ON contractors(category);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_pro_accounts_email ON pro_accounts(email);
CREATE INDEX IF NOT EXISTS idx_lead_assignments_lead ON lead_assignments(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_credits_pro ON lead_credits(pro_account_id);
