-- ============================================================
--  Zalo Bot Platform - database schema (MySQL / MariaDB)
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name          VARCHAR(120) NOT NULL,
  email         VARCHAR(190) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role          ENUM('admin','user') NOT NULL DEFAULT 'user',
  status        ENUM('pending','approved','rejected','suspended') NOT NULL DEFAULT 'pending',
  approved_by   INT UNSIGNED NULL,
  approved_at   DATETIME NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bots (
  id                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id            INT UNSIGNED NOT NULL,
  name               VARCHAR(120) NOT NULL,
  token_enc          TEXT NOT NULL,                 -- encrypted Zalo bot token
  zalo_bot_id        VARCHAR(120) NULL,             -- discovered via getMe
  zalo_bot_name      VARCHAR(190) NULL,
  mode               ENUM('webhook','polling','off') NOT NULL DEFAULT 'webhook',
  webhook_secret     VARCHAR(120) NOT NULL,         -- X-Bot-Api-Secret-Token value
  status             ENUM('active','inactive') NOT NULL DEFAULT 'active',
  ai_enabled         TINYINT(1) NOT NULL DEFAULT 0,
  ai_provider        VARCHAR(40) NOT NULL DEFAULT 'gemini',
  ai_api_key_enc     TEXT NULL,                     -- encrypted; null => use global key
  ai_model           VARCHAR(80) NULL,
  ai_system_prompt   TEXT NULL,
  custom_code_enabled TINYINT(1) NOT NULL DEFAULT 0,
  custom_code        MEDIUMTEXT NULL,               -- user JS handler
  last_update_id     BIGINT NULL,                   -- polling offset cursor
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_bots_user (user_id),
  CONSTRAINT fk_bots_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bot_logs (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  bot_id      INT UNSIGNED NOT NULL,
  direction   ENUM('in','out','system','error') NOT NULL,
  event_type  VARCHAR(80) NULL,
  chat_id     VARCHAR(120) NULL,
  chat_type   VARCHAR(40) NULL,
  from_id     VARCHAR(120) NULL,
  from_name   VARCHAR(190) NULL,
  content     TEXT NULL,
  raw         MEDIUMTEXT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_logs_bot (bot_id, id),
  CONSTRAINT fk_logs_bot FOREIGN KEY (bot_id) REFERENCES bots (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Outbound integration webhooks: forward incoming Zalo events to external URLs.
CREATE TABLE IF NOT EXISTS webhooks (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  bot_id      INT UNSIGNED NOT NULL,
  name        VARCHAR(120) NOT NULL,
  target_url  VARCHAR(500) NOT NULL,
  secret      VARCHAR(190) NULL,                    -- sent as X-Webhook-Secret
  events      VARCHAR(255) NOT NULL DEFAULT '*',    -- comma list or *
  enabled     TINYINT(1) NOT NULL DEFAULT 1,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_webhooks_bot (bot_id),
  CONSTRAINT fk_webhooks_bot FOREIGN KEY (bot_id) REFERENCES bots (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- External data sources the user can query from custom handlers (MariaDB/MySQL/SQL Server).
CREATE TABLE IF NOT EXISTS datasources (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id       INT UNSIGNED NOT NULL,
  name          VARCHAR(120) NOT NULL,
  type          ENUM('mysql','mariadb','mssql') NOT NULL DEFAULT 'mysql',
  host          VARCHAR(190) NOT NULL,
  port          INT NOT NULL DEFAULT 3306,
  username      VARCHAR(190) NOT NULL,
  password_enc  TEXT NULL,
  db_name       VARCHAR(190) NOT NULL,
  options_json  TEXT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ds_user (user_id),
  CONSTRAINT fk_ds_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Session store table (express-mysql-session) is auto-created by the library.
