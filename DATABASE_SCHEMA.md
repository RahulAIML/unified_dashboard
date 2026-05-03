# coach_app — Database Schema Reference

**Engine:** MySQL 8 / InnoDB
**Charset:** utf8mb4 (full Unicode + emoji support)
**Total tables:** 40
**Source file:** `coach_app.sql`

This document describes every table, every field, its type, purpose, and how tables relate to each other. It also notes which tables are used for dashboard KPIs and which are internal platform infrastructure.

---

## Table of Contents

1. [Core Tenant & User Tables](#1-core-tenant--user-tables)
2. [Use Case & Scenario Tables](#2-use-case--scenario-tables)
3. [Session & Results Tables](#3-session--results-tables)  ← **Primary dashboard data**
4. [Evaluation Tables](#4-evaluation-tables)              ← **Certification data**
5. [Messaging Tables](#5-messaging-tables)
6. [AI & Avatar Configuration](#6-ai--avatar-configuration)
7. [Prompt Templates](#7-prompt-templates)
8. [Dynamic Form & Token Tables](#8-dynamic-form--token-tables)
9. [System & Settings Tables](#9-system--settings-tables)
10. [Entity Relationship Summary](#10-entity-relationship-summary)
11. [Dashboard KPI Mapping](#11-dashboard-kpi-mapping)
12. [Missing Data (Not Stored)](#12-missing-data-not-stored)

---

## 1. Core Tenant & User Tables

### `admin_user` — Client accounts (tenants)
Each row is one paying client organisation. All other data is scoped to a `customer_id` that references this table.

| Field | Type | Notes |
|-------|------|-------|
| `id` | int unsigned PK | Tenant ID — used as `customer_id` throughout the DB |
| `company_name` | varchar(190) | Organisation display name |
| `email` | varchar(190) UNIQUE | Login email for the admin account |
| `pwd` | varchar(255) | Hashed password |
| `access` | tinyint(1) | `0` = normal client, `1` = superadmin |
| `enable_api` | tinyint unsigned | Whether API access is enabled for this tenant |
| `api_key` | varchar(255) | API key for programmatic access |
| `logo` | varchar(100) | Logo filename |
| `homepage_content` | varchar(2000) | Custom homepage text |
| `date` | datetime | Account creation date |

---

### `coach_users` — End users (learners)
Users who log in to practice, take sessions, and get evaluated. Each belongs to one tenant.

| Field | Type | Notes |
|-------|------|-------|
| `id` | int unsigned PK | User ID |
| `customer_id` | int unsigned FK → `admin_user.id` | Tenant this user belongs to |
| `user_email` | varchar(190) | Login email |
| `user_pass` | varchar(190) | Hashed password |
| `user_name` | varchar(100) | Display name |
| `signup` | tinyint(1) | `1` = user completed signup, `0` = invited but not yet registered |
| `date_added` | datetime | When this user was added to the platform |

**Dashboard use:** `COUNT(*)` = Total Users KPI. `date_added` = user growth over time.

---

### `site_users` — Secondary user table (rolplay.pro platform)
A separate user table used by the rolplay.pro platform. Structurally similar to `coach_users` but for a different product.

| Field | Type | Notes |
|-------|------|-------|
| `id` | int unsigned PK | |
| `customer_id` | int unsigned FK | Tenant |
| `uname` | varchar(190) | Username |
| `email` | varchar(190) | Login email |
| `pwd` | varchar(255) | Hashed password |
| `date_added` | datetime | Registration date |

**Note:** LMS data is likely stored in the rolplay.pro database, separate from this schema.

---

### `coach_managers` — Manager accounts
Managers can oversee teams of users within a tenant. Different from the admin (`admin_user`).

| Field | Type | Notes |
|-------|------|-------|
| `ID` | int unsigned PK | |
| `customer_id` | int unsigned FK → `admin_user.id` | Tenant |
| `email` | varchar(50) | Manager login email |
| `pwd` | varchar(190) | Hashed password |
| `name` | varchar(100) | Display name |
| `created_on` | datetime | When manager account was created |

---

### `coach_manager_users` — Manager ↔ User assignments
Maps which managers oversee which users.

| Field | Type | Notes |
|-------|------|-------|
| `ID` | int PK | |
| `manager_id` | int unsigned FK → `coach_managers.ID` | |
| `user_id` | int unsigned FK → `coach_users.id` | |

---

### `coach_teams` — User teams
Groups of users within a tenant, used for group evaluation sessions.

| Field | Type | Notes |
|-------|------|-------|
| `ID` | int unsigned PK | |
| `customer_id` | int unsigned FK → `admin_user.id` | Tenant |
| `team_name` | varchar(50) | Team display name |

---

### `coach_team_user` — Team ↔ User memberships
Many-to-many: a user can be in multiple teams.

| Field | Type | Notes |
|-------|------|-------|
| `ID` | int PK | |
| `team_id` | int unsigned FK → `coach_teams.ID` | |
| `user_id` | int unsigned FK → `coach_users.id` | |

---

### `ugroups` — User groups (rolplay.pro)
Another grouping mechanism, used on the rolplay.pro side.

| Field | Type | Notes |
|-------|------|-------|
| `id` | int unsigned PK | |
| `customer_id` | int unsigned | Tenant |
| `group_name` | varchar(190) | |
| `logo` | varchar(190) | Group logo |
| `date_created` | datetime | |

---

## 2. Use Case & Scenario Tables

### `usecases` — Base / template use cases
Master library of use case templates. These are the blueprints that clients copy and customise.

| Field | Type | Notes |
|-------|------|-------|
| `id` | int unsigned PK | Base use case ID |
| `customer_id` | int unsigned | Owner tenant (usually platform admin) |
| `usecase_name` | varchar(100) | Display name |
| `iteration` | tinyint | Version counter |
| `ai_model_id` | int unsigned FK → `ai_models.id` | Default AI model |
| `lang` | varchar(190) | Language code (e.g. `en-US`) |
| `tool_type` | tinyint(1) | `0`=none, `1`=retrieval, `2`=code interpreter, `3`=functions |
| `logo` | varchar(255) | Logo file |
| `file_name` | varchar(190) | Attached knowledge file |
| `video_url` | varchar(190) | Intro video URL |
| `interaction_type` | tinyint unsigned | `1`=Realtime+Video, `2`=Realtime, `3`=Video, `4`=Audio, `5`=Realtime+Audio, `6`=Audio+Video, `7`=All three |
| `realtime_label` / `video_label` / `audio_label` | varchar(190) | Button labels for each modality |
| `instructions` | text | System instructions for the AI |
| `enable_correction_prompt` | tinyint(1) | Whether live correction is on |
| `correction_prompt` | text | Correction prompt text |
| `passcode` | varchar(255) | Optional access passcode |
| `live_retro` | tinyint(1) | Whether live retrospective is enabled |
| `direct_access` | tinyint unsigned | Whether users can access directly (no team assignment) |
| `direct_avatar` / `direct_avatar_name` / `direct_avatar_accent` | varchar | Avatar config for direct access |
| `direct_interaction_type` | tinyint unsigned | `1`=Realtime, `2`=Video, `3`=Audio |
| `direct_user_name` | varchar(100) | User persona name for direct access |
| `segmented_content` | tinyint(1) | Whether this use case uses the segmented content / certification flow |
| `date_created` | datetime | |

---

### `coach_usecases` — Customer-configured use cases
Each tenant's customised version of a base use case. This is what users actually interact with.

| Field | Type | Notes |
|-------|------|-------|
| `id` | int unsigned PK | Customer use case ID |
| `base_usecase_id` | int unsigned FK → `usecases.id` | The base template this was copied from |
| `customer_id` | int unsigned FK → `admin_user.id` | Tenant owner |
| `usecase_name` | varchar(100) | Customised name |
| `added_instructions` | text | Extra instructions on top of base |
| `added_content` | longtext | Extra knowledge content |
| `base_direct_access` | tinyint unsigned | |
| `direct_avatar` / `direct_avatar_name` / `direct_avatar_accent` | varchar | Avatar overrides |
| `direct_interaction_type` | tinyint unsigned | `1`=Realtime, `2`=Video, `3`=Audio |
| `direct_user_name` | varchar(100) | |
| `intro_video` | varchar(255) | |
| `intro_desc` | text | Intro description shown to users |
| `pronunciations` | text | Custom pronunciation rules |
| `date_created` | datetime | When this config was created |
| `external_transcript` | smallint | Whether external transcript is enabled |

**Dashboard use:** `COUNT(*)` = Configured Use Cases / Scenarios KPI.

---

### `coach_usecase_user` — User ↔ Use case assignments
Which users are assigned to which use cases.

| Field | Type | Notes |
|-------|------|-------|
| `id` | int unsigned PK | |
| `customer_id` | int unsigned FK → `admin_user.id` | Tenant |
| `usecase_id` | int unsigned FK → `coach_usecases.id` | |
| `user_id` | int unsigned FK → `coach_users.id` | |
| `curr_stage` | int | The stage the user is currently on (default `1`) |

**Dashboard use:** `COUNT(DISTINCT user_id)` = Assigned Users KPI.

---

### `usecase_customers` — Which base use cases are available to which tenants
Controls which base templates a client can access and deploy.

| Field | Type | Notes |
|-------|------|-------|
| `id` | int unsigned PK | |
| `usecase_id` | int unsigned FK → `usecases.id` | Base use case |
| `customer_id` | int unsigned | Tenant granted access |

---

### `usecase_stages` — Stages within a customer use case
Defines the conversation stages / chapters for a use case. Users progress through these stages.

| Field | Type | Notes |
|-------|------|-------|
| `ID` | int unsigned PK | |
| `coach_usecase_id` | int unsigned FK → `coach_usecases.id` | |
| `sequence` | smallint | Order of this stage (1, 2, 3…) |
| `name` | varchar(50) | Stage name |
| `one_liner` | varchar(100) | Short description |
| `content` | longtext | Knowledge content for this stage |
| `instructions` | text | AI instructions for this stage |

**Dashboard use:** `COUNT(*)` = Knowledge Stages KPI for Master Coach.

---

### `usecase_segment` — Certification segments (within a base use case)
Groups content segments for use cases with `segmented_content = 1` (i.e. certification use cases).

| Field | Type | Notes |
|-------|------|-------|
| `id` | int unsigned PK | Segment group ID |
| `usecase_id` | int unsigned FK → `usecases.id` | Base use case |
| `title` | varchar(255) | Segment group title |

---

### `segment_contents` — Individual content pieces within a segment
The actual documents, files, or text blocks that form the knowledge base for a certification segment. **This is the closest equivalent to a Second Brain document store in this schema.**

| Field | Type | Notes |
|-------|------|-------|
| `id` | int unsigned PK | Content segment ID |
| `usecase_segment_id` | int unsigned FK → `usecase_segment.id` | Parent segment group |
| `segment_num` | tinyint unsigned | Order within the group |
| `min_score` | tinyint | Minimum passing score for this segment (0–100) |
| `file` | varchar(255) | Filename of uploaded document (pdf, docx, pptx, xlsx, mp4, etc.) |
| `content` | mediumtext | Raw text content (if entered manually) |
| `content_from` | tinyint(1) | `1` = from uploaded file, `2` = from text |
| `instruction_prompt` | text | AI instruction for evaluating against this content |
| `evaluation_prompt` | text | Prompt used to generate the evaluation score |
| `date_created` | datetime | When this segment was created |
| `name` | varchar(100) | Display name |
| `template` | text | Template for AI response generation |
| `questions` | text | Pre-defined questions for this segment |

**Dashboard use:** `COUNT(*)` = Knowledge Documents / Content Segments KPIs. `file` extension = File Types Indexed. `date_created` = upload trend over time.

---

### `usecase_group` — Use case ↔ Group assignments
| Field | Type | Notes |
|-------|------|-------|
| `id` | int unsigned PK | |
| `usecase_id` | int unsigned | |
| `group_id` | int unsigned | |

---

### `usecase_help_text` — Contextual help for use cases
In-app help text shown during a use case session.

| Field | Type | Notes |
|-------|------|-------|
| `id` | int unsigned PK | |
| `usecase_id` | int unsigned | |
| `name_and_template` | varchar(1000) | Help item name and template |
| `content` | varchar(1000) | Help content text |
| `sys_instruction` | varchar(1000) | AI instruction context |

---

### `usecase_instructions` — Step-by-step instructions
| Field | Type | Notes |
|-------|------|-------|
| `id` | int unsigned PK | |
| `usecase_id` | int unsigned | |
| (additional instruction fields) | | |

---

### `usecase_termins` — Terminology / glossary per use case
Custom terms and definitions associated with a use case.

---

### `usecase_accents` — Language accent options per use case
Defines which language/accent combinations are available for a use case's AI voice.

| Field | Type | Notes |
|-------|------|-------|
| `id` | int unsigned PK | |
| `usecase_id` | int unsigned FK → `usecases.id` | |
| `language_code` | varchar(190) | e.g. `en-US` |
| `accent_code` | varchar(190) | TTS accent code |
| `accent_text` | varchar(190) | Human-readable label |
| `class_name` | varchar(190) | CSS class for UI |

---

### `usecase_avatars` — Avatar assignments per use case
Which avatars can be used with a given use case.

| Field | Type | Notes |
|-------|------|-------|
| `id` | int unsigned PK | |
| `usecase_id` | int unsigned FK → `usecases.id` | |
| `avatar_id` | int unsigned FK → `avatars.id` | |
| `is_default` | tinyint(1) | `1` = this is the default avatar |

---

### `usecase_ai_models` — AI model options per use case
Which AI models are available for a given use case (allows multi-model support).

| Field | Type | Notes |
|-------|------|-------|
| `id` | int unsigned PK | |
| `usecase_id` | int unsigned FK → `usecases.id` | |
| `ai_model_id` | int unsigned FK → `ai_models.id` | |
| `display_order` | tinyint unsigned | Order in selection UI |

---

## 3. Session & Results Tables

> **These tables are the primary source for all dashboard metrics.**

### `saved_reports` — Individual practice / evaluation session results
**The most important table for dashboard analytics.** Every completed session (practice or evaluation) produces one row here.

| Field | Type | Notes |
|-------|------|-------|
| `id` | int unsigned PK | Session result ID |
| `uid` | varchar(191) UNIQUE | Public-facing unique token for the report URL |
| `usecase_id` | int unsigned FK → `coach_usecases.id` | Which use case was practised |
| `coach_user_id` | int unsigned FK → `coach_users.id` | Which user completed it |
| `interaction_type` | tinyint(1) | Modality: Realtime / Video / Audio |
| `sitepal_image` | varchar(100) | Avatar image used |
| `elevator_pitch` | text | User's opening pitch transcript |
| `closingretro` | text | AI-generated retrospective / feedback text |
| `usecase_stage_id` | int unsigned FK → `usecase_stages.ID` | Which stage was practised |
| `date_created` | datetime | When the session was completed |
| `eval_session_id` | int unsigned | FK → `coach_evaluation_sessions.id` — **NULL for practice sessions, populated for certification evaluations** |
| `usecase_segment_id` | int unsigned | FK → `usecase_segment.id` — populated for segmented / certification flows |
| `segment_num` | tinyint unsigned | Which segment number within the evaluation |
| `score` | int | **Numeric score (0–100) for this session** |
| `passed_flag` | smallint | **`1` = passed, `0` = failed** — based on `segment_contents.min_score` threshold |

**Dashboard use:**
- `COUNT(*)` → Total Sessions KPI
- `AVG(score)` → Average Score KPI
- `SUM(passed_flag) / COUNT(*)` → Pass Rate KPI
- `WHERE eval_session_id IS NULL` → Practice Simulator sessions
- `WHERE eval_session_id IS NOT NULL` → Expert Certification results
- `date_created` → All time-series charts

---

### `saved_reports_options` — Q&A detail per session
One row per question within a session. Contains the AI question, user's response, and the AI's retrospective on that response.

| Field | Type | Notes |
|-------|------|-------|
| `id` | int unsigned PK | |
| `saved_report_id` | int unsigned FK → `saved_reports.id` | Parent session |
| `seq` | int unsigned | Question sequence number |
| `gen_ques` | text | The generated question text |
| `ai_ques` | varchar(255) | AI question identifier / key |
| `user_resp` | text | The user's text response |
| `user_respV` | varchar(255) | User's voice/video response reference |
| `retro` | text | AI feedback on this specific answer |

**Note:** This table contains rich session detail (what was asked, what was answered, what the AI said about it). Not yet surfaced in the dashboard but valuable for drill-down panels in Phase 2.

---

## 4. Evaluation Tables

### `coach_evaluation_sessions` — Formal evaluation sessions
An evaluation session groups one or more users (or a team) for a formal certification evaluation.

| Field | Type | Notes |
|-------|------|-------|
| `id` | int unsigned PK | Evaluation session ID |
| `usecase_segment_id` | int unsigned FK → `usecase_segment.id` | Which segment is being evaluated |
| `customer_id` | int unsigned FK → `admin_user.id` | Tenant |
| `title` | varchar(255) | Session title / label |
| `date_created` | datetime | When the evaluation session was created |

**Dashboard use:** Linked via `saved_reports.eval_session_id` to filter certification results from practice results.

---

### `coach_evaluation_session_segments` — Segment timing within an evaluation
Tracks when each content segment started and ended within an evaluation session. **This is the only table in the schema with both start and end timestamps.**

| Field | Type | Notes |
|-------|------|-------|
| `id` | int unsigned PK | |
| `evaluation_session_id` | int unsigned FK → `coach_evaluation_sessions.id` | |
| `content_segment_id` | int unsigned FK → `segment_contents.id` | Which segment |
| `start_date` | datetime | When this segment started |
| `end_date` | datetime | When this segment ended |

**Note:** `end_date - start_date` = duration for each segment. This is **the only available duration data** in the entire schema. Not yet exposed in the dashboard.

---

### `coach_evaluation_session_team` — Team assignments to evaluation sessions
Links teams to a specific evaluation session (for group evaluations).

| Field | Type | Notes |
|-------|------|-------|
| `id` | int unsigned PK | |
| `evaluation_session_id` | int unsigned FK → `coach_evaluation_sessions.id` | |
| `team_id` | int unsigned FK → `coach_teams.ID` | |

---

## 5. Messaging Tables

### `messages` — Direct messages between users and admins
One-on-one messages sent within the platform (between users and the coach admin).

| Field | Type | Notes |
|-------|------|-------|
| `id` | int unsigned PK | |
| `sender_id` | int unsigned | Sender's user ID |
| `receiver_id` | int unsigned | Receiver's user ID |
| `for_admin` | tinyint(1) | `1` = sent to coach admin, `0` = sent to user |
| `content` | mediumtext | Message body |
| `usecase_id` | int unsigned | The use case this message is about (`0` if general) |
| `date_created` | datetime | Send timestamp |
| `is_read` | tinyint(1) | `0` = unread, `1` = read |

---

### `group_messages` — Group chat messages
Messages sent in a group chat context, tied to a specific use case session.

| Field | Type | Notes |
|-------|------|-------|
| `ID` | int PK | |
| `date` | datetime | Send timestamp |
| `sender_id` | int unsigned FK → `coach_users.id` | |
| `message` | varchar(1000) | Message text |
| `usecase_id` | int unsigned FK → `coach_usecases.id` | Use case this belongs to |

---

## 6. AI & Avatar Configuration

### `ai_providers` — AI provider registry
| Field | Type | Notes |
|-------|------|-------|
| `id` | int unsigned PK | |
| `provider_name` | varchar(190) | e.g. `OpenAI`, `Anthropic`, `Azure` |

---

### `ai_models` — AI model registry
Available models that can be assigned to use cases.

| Field | Type | Notes |
|-------|------|-------|
| `id` | int unsigned PK | |
| `ai_provider_id` | int unsigned FK → `ai_providers.id` | |
| `model_name` | varchar(200) | Human-readable name (e.g. `GPT-4o`) |
| `model_code` | varchar(200) | API model identifier (e.g. `gpt-4o`) |

---

### `avatars` — AI avatar definitions
The visual avatars (SitePal or similar) used in video/realtime interactions.

| Field | Type | Notes |
|-------|------|-------|
| `id` | int unsigned PK | |
| `value` | varchar(20) UNIQUE | Internal code |
| `avatar_name` | varchar(190) | Display name |
| `gender` | varchar(1) | `m`=male, `f`=female, `o`=other |
| `image` | varchar(190) | Preview image path |
| `sitepal_code` | text | SitePal embed code |
| `is_default` | tinyint(1) | Whether this is the platform default |
| `date_added` | datetime | |

---

## 7. Prompt Templates

### `prompts` — Main conversation prompts
The core AI prompts that drive each use case's conversation flow.

| Field | Type | Notes |
|-------|------|-------|
| `id` | int unsigned PK | |
| `usecase_id` | int unsigned | |
| `ai_model_id` | int unsigned FK → `ai_models.id` | Model for this prompt |
| `title` | varchar(100) | Prompt name |
| `prompt_text` | text | Primary prompt |
| `prompt_text2` / `prompt_text3` | text | Alternate prompt variants |
| `prompt_placeholders` | varchar(190) | Comma-separated placeholder names |
| `sequence` | int unsigned | Order in the conversation |
| `lang` | varchar(50) | Language (e.g. `en-US`) |
| `ai_instructions_1` / `ai_instructions_2` | text | Supplementary AI instructions |
| `date_created` | datetime | |

---

### `closingprompts` — Closing / wrap-up prompts
Prompts used at the end of a session to generate a closing message or summary.

| Field | Type | Notes |
|-------|------|-------|
| `id` | int unsigned PK | |
| `usecase_id` | int unsigned | |
| `ai_model_id` | int unsigned FK → `ai_models.id` | |
| `title` | varchar(200) | |
| `prompt_type` | varchar(100) | Category of closing prompt |
| `prompt_text` / `prompt_text2` / `prompt_text3` | text | Prompt variants |
| `template` | text | Output template |
| `lang` | varchar(50) | |
| `date_created` | datetime | |

---

### `retroprompts` — Retrospective / feedback prompts
Prompts used to generate AI retrospective feedback after a session.

| Field | Type | Notes |
|-------|------|-------|
| `id` | int unsigned PK | |
| `usecase_id` | int unsigned | |
| `ai_model_id` | int unsigned FK → `ai_models.id` | |
| `title` | varchar(200) | |
| `prompt_type` | varchar(100) | |
| `prompt_text` / `prompt_text2` / `prompt_text3` | text | |
| `template` | text | |
| `lang` | varchar(50) | |
| `date_created` | datetime | |

---

## 8. Dynamic Form & Token Tables

### `forms` — Form field definitions per use case
Pre-session forms that collect user input (e.g. context, scenario parameters) before a session starts.

| Field | Type | Notes |
|-------|------|-------|
| `id` | int unsigned PK | |
| `usecase_id` | int | |
| `prompt_placeholder` | varchar(100) | The `{{placeholder}}` this field maps to in the prompt |
| `field_type` | tinyint | `1`=text, `2`=textarea, `3`=select, `4`=upload |
| `label` | varchar(100) | Field label shown to the user |
| `field_values` | text | Options (for select type), pipe-separated |
| `field_order` | tinyint | Display order |

---

### `dyn_fields` — Dynamic field rules
Rules for showing/hiding form fields based on other field values (conditional logic).

| Field | Type | Notes |
|-------|------|-------|
| `ID` | int PK | |
| `source_fld_id` | int | The field that triggers the rule |
| `target_fld_name` | varchar(100) | The field to affect |
| `trigger_name` | varchar(25) | Event type (e.g. `change`) |
| `trigger_elem` | varchar(255) | CSS selector or field reference |
| `action` | varchar(25) | Action to take (e.g. `show`, `hide`) |
| `target_value` | varchar(1000) | Value that triggers the action |
| `target_field_type` | varchar(25) | Type of the target field |
| `usecase_id` | int | |
| `exit_target_fld_name` | varchar(100) | Field to affect when trigger exits |
| `exit_action` / `exit_target_value` / `exit_target_field_type` | various | Exit-condition counterparts |

---

### `replaceTokens` — Prompt token replacement rules
Defines dynamic tokens in prompts and their replacement values.

| Field | Type | Notes |
|-------|------|-------|
| `id` | int unsigned PK | |
| `usecase_id` | int unsigned | |
| `token` | varchar(255) | Token name (e.g. `{{company_name}}`) |
| `value` | text | Replacement value or list |
| `token_type` | enum(`normal`, `random`) | `normal` = fixed value, `random` = pick randomly from list |

---

## 9. System & Settings Tables

### `admin_settings` — Platform-wide settings
Key-value store for global platform configuration.

| Field | Type | Notes |
|-------|------|-------|
| `id` | int unsigned PK | |
| `setting_name` | varchar(190) UNIQUE | Setting key |
| `setting_value` | varchar(190) | Setting value |

---

### `saved_reports` ← (already documented in §3)

---

### `wa_takeda` — Client-specific table
A dedicated table for the Takeda client. Contains client-specific data not in the generic schema. Exact schema varies.

---

## 10. Entity Relationship Summary

```
admin_user (tenant)
│
├── coach_users (end users)
│     ├── coach_team_user ──────────── coach_teams
│     ├── coach_manager_users ──────── coach_managers
│     ├── coach_usecase_user ───────── coach_usecases
│     │                                      │
│     │                               ┌──────┴──────────┐
│     │                           usecases          usecase_stages
│     │                               │
│     │                       usecase_segment
│     │                               │
│     │                       segment_contents (min_score, file, date_created)
│     │
│     └── saved_reports ──────────────────────────────── KEY TABLE
│           │  score, passed_flag, date_created
│           │  eval_session_id (NULL = practice, set = certification)
│           │
│           ├── saved_reports_options (Q&A detail)
│           └── coach_evaluation_sessions
│                     │
│                     ├── coach_evaluation_session_segments (start_date, end_date)
│                     └── coach_evaluation_session_team ── coach_teams
│
├── coach_usecases
│     ├── usecase_stages
│     ├── group_messages
│     └── messages
│
└── usecases (base templates)
      ├── usecase_customers
      ├── usecase_segment → segment_contents
      ├── usecase_avatars → avatars
      ├── usecase_ai_models → ai_models → ai_providers
      ├── usecase_accents
      ├── usecase_help_text
      ├── prompts
      ├── closingprompts
      ├── retroprompts
      ├── forms
      ├── dyn_fields
      └── replaceTokens
```

---

## 11. Dashboard KPI Mapping

| Dashboard KPI | Table(s) | Field(s) | SQL pattern |
|---------------|----------|----------|-------------|
| Total Users | `coach_users` | `id` | `SELECT COUNT(*) FROM coach_users WHERE customer_id = ?` |
| Assigned to Scenarios | `coach_usecase_user` | `user_id` | `SELECT COUNT(DISTINCT user_id) FROM coach_usecase_user WHERE customer_id = ?` |
| Practice Sessions | `saved_reports` | `id`, `eval_session_id` | `SELECT COUNT(*) FROM saved_reports WHERE eval_session_id IS NULL AND coach_user_id IN (SELECT id FROM coach_users WHERE customer_id = ?)` |
| Avg Session Score | `saved_reports` | `score` | `SELECT AVG(score) FROM saved_reports WHERE date_created BETWEEN ? AND ?` |
| Overall Pass Rate | `saved_reports` | `passed_flag` | `SELECT SUM(passed_flag) / COUNT(*) FROM saved_reports` |
| Certified Users | `saved_reports` | `coach_user_id`, `eval_session_id`, `passed_flag` | `SELECT COUNT(DISTINCT coach_user_id) FROM saved_reports WHERE eval_session_id IS NOT NULL AND passed_flag = 1` |
| Configured Use Cases | `coach_usecases` | `id` | `SELECT COUNT(*) FROM coach_usecases WHERE customer_id = ?` |
| Active Teams | `coach_teams` | `ID` | `SELECT COUNT(*) FROM coach_teams WHERE customer_id = ?` |
| Knowledge Stages | `usecase_stages` | `ID` | `SELECT COUNT(*) FROM usecase_stages WHERE coach_usecase_id IN (SELECT id FROM coach_usecases WHERE customer_id = ?)` |
| Knowledge Documents | `segment_contents` | `id` | `SELECT COUNT(*) FROM segment_contents` |
| File Types Indexed | `segment_contents` | `file` | `SELECT COUNT(DISTINCT SUBSTRING_INDEX(file, '.', -1)) FROM segment_contents WHERE file IS NOT NULL` |
| Certification Candidates | `saved_reports` | `coach_user_id` | `SELECT COUNT(DISTINCT coach_user_id) FROM saved_reports WHERE eval_session_id IS NOT NULL` |
| Pending Evaluations | `coach_usecase_user`, `saved_reports` | — | Users in `coach_usecase_user` with no matching row in `saved_reports` for a certification use case |
| Activity Trend | `saved_reports` | `date_created` | `SELECT DATE(date_created), COUNT(*) FROM saved_reports GROUP BY DATE(date_created)` |
| Pass/Fail Over Time | `saved_reports` | `date_created`, `passed_flag` | `GROUP BY DATE(date_created)` with conditional sums |
| Score Trend | `saved_reports` | `date_created`, `score` | `SELECT DATE(date_created), AVG(score) FROM saved_reports GROUP BY DATE(date_created)` |
| Segment Duration | `coach_evaluation_session_segments` | `start_date`, `end_date` | `SELECT TIMEDIFF(end_date, start_date)` — **only duration data in schema** |

---

## 12. Missing Data (Not Stored)

The following data points are **not present in this schema** and cannot be derived from it. They require new tracking infrastructure and a privacy policy update before they can be collected.

| Metric | Why it's missing | Phase |
|--------|-----------------|-------|
| Session start timestamp per user | No per-session start event is logged outside evaluation segments | Phase 2 |
| Session duration (practice) | `saved_reports` has only `date_created` (end), no start. Only `coach_evaluation_session_segments` has both | Phase 2 |
| Last active date per user | No session log or activity table | Phase 2 |
| Number of questions asked per session | `saved_reports_options` stores Q&A but has no timestamp per question | Phase 2 |
| Second Brain query logs | No query tracking table exists | Phase 2 |
| Master Coach interaction counts | No interaction counter per session | Phase 2 |
| LMS modules / completions / quiz scores | Not in this schema — stored in the `rolplay.pro` database | Week 1 audit |
| Page views / navigation events | No front-end event tracking | Phase 2 |
| Cross-solution active users | No per-solution session table to join | Phase 2 |
