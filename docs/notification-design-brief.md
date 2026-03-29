# Email Template Design Brief — Carbon Lens

> **Product:** Carbon Lens (ESG Lite)
> **Scope:** Email notification templates only (10 types)
> **Date:** March 2026

---

## 1. Overview

Carbon Lens sends automated email notifications to users when their emission/production data is approved, rejected, or when monthly submission deadlines approach. We need premium, professional HTML email templates for **10 email types**.

---

## 2. Brand Identity

| Element | Value |
|---------|-------|
| **Brand Name** | Carbon Lens |
| **Product** | ESG / Carbon emission tracking platform |
| **Audience** | Corporate sustainability teams (Middle East, India, Europe) |
| **Tone** | Professional, clean, trustworthy |
| **Logo** | Provided separately (use in header) |

### Color Palette

| Token | Hex | Usage |
|-------|-----|-------|
| **Primary** | `#059669` (Emerald 600) | Header gradient start, approved badge |
| **Primary Dark** | `#064e3b` (Emerald 900) | Header gradient end |
| **Teal Accent** | `#0d9488` | Secondary accent |
| **Approved Green** | `#047857` | Status badge, text |
| **Rejected Red** | `#dc2626` | Status badge, text |
| **Warning Amber** | `#d97706` | Deadline/escalation accent |
| **CTA Blue** | `#2563eb` | "View Details" button |
| **Text Dark** | `#111827` | Heading text |
| **Text Body** | `#374151` | Body paragraphs |
| **Text Muted** | `#6b7280` | Secondary info |
| **Border** | `#e5e7eb` | Card borders, dividers |
| **Background** | `#f9fafb` | Email body background |
| **White** | `#ffffff` | Content card background |

---

## 3. Email Layout Structure

All 10 emails share the same base layout. Content blocks vary by type.

```
+=============================================+
|                                             |
|     CARBON LENS                             |  ← Header banner
|     [Logo]  Carbon Lens                     |     Emerald gradient background
|                                             |     White text, centered or left-aligned
+=============================================+
|                                             |
|  Hello {First Name},                        |  ← Greeting
|                                             |
|  {Body text explaining what happened}       |  ← Body paragraph
|                                             |
|  +=========================================+|
|  |                                         ||
|  |          ✓  APPROVED                    ||  ← Status badge (centered)
|  |                                         ||     Green bg for approved
|  +=========================================+|     Red bg for rejected
|                                             |     Amber bg for reminder
|  +-----------------------------------------+|
|  |  Category    |  Scope 1 - Electricity   ||  ← Detail card (key-value pairs)
|  |  Site        |  Dubai HQ                ||     Gray background, rounded
|  |  Status      |  Approved                ||     2-column table layout
|  +-----------------------------------------+|
|                                             |
|  +-----------------------------------------+|
|  |  ⚡ Rejection Reason                    ||  ← Rejection callout (only for rejections)
|  |                                         ||     Amber/yellow background
|  |  "Missing source documentation for      ||     Quoted comment from manager
|  |   electricity consumption data"         ||
|  +-----------------------------------------+|
|                                             |
|  +-----------------------------------------+|
|  |  Submitted by:  John Doe                ||  ← Action trail (who did what)
|  |                 john@company.com         ||     Shows submitter AND approver/rejector
|  |                                         ||     Builds transparency
|  |  Approved by:   Sarah Manager           ||
|  |                 sarah@company.com        ||
|  |                 (Manager)               ||
|  +-----------------------------------------+|
|                                             |
|            [ View Details → ]               |  ← CTA button
|                                             |     Blue, rounded, centered
|                                             |     Links to the app
|                                             |
|  Best regards,                              |  ← Sign-off
|  The Carbon Lens Team                       |
|                                             |
+---------------------------------------------+
|                                             |
|  © 2026 Carbon Lens                         |  ← Footer
|  Manage Notification Preferences            |     Muted text, centered
|                                             |     Link to settings page
+---------------------------------------------+
```

---

## 4. The 10 Email Types

### Group A: Single Approval/Rejection (4 types)

These are sent when a manager approves or rejects **one** emission or production data entry.

#### A1. Emission Approved
- **Subject:** "Emission Data Approved — Carbon Lens"
- **Status badge:** ✓ APPROVED (green)
- **Detail card fields:** Category, Site, Status
- **Action trail:** Shows submitter + approving manager
- **CTA:** "View Details →"
- **Tone:** Positive — "Your data is now part of the official records"

#### A2. Emission Rejected
- **Subject:** "Emission Data Rejected — Carbon Lens"
- **Status badge:** ✗ REJECTED (red)
- **Detail card fields:** Category, Site, Status
- **Rejection callout:** Manager's comment in amber box
- **Action trail:** Shows submitter + rejecting manager
- **CTA:** "View Details →"
- **Tone:** Constructive — "Please review and resubmit with corrections"

#### A3. Production Data Approved
- **Subject:** "Production Data Approved — Carbon Lens"
- **Same layout as A1** but references "production data" and shows **Product Name** instead of Category

#### A4. Production Data Rejected
- **Subject:** "Production Data Rejected — Carbon Lens"
- **Same layout as A2** but references "production data" and shows **Product Name**

---

### Group B: Bulk Approval/Rejection (4 types)

These are sent when a manager approves or rejects **multiple** entries at once. One email per affected user.

#### B1. Bulk Emissions Approved
- **Subject:** "Emission Data Approved — Carbon Lens"
- **Status badge:** ✓ APPROVED (green)
- **Counter badge:** "12 entries approved" (shows total count)
- **Summary table:** Category name + count per category
  ```
  | Category                  | Count |
  |---------------------------|-------|
  | Scope 1 - Electricity     |     5 |
  | Scope 2 - Transport       |     4 |
  | Scope 3 - Waste           |     3 |
  ```
- **Action trail:** Shows approving manager
- **CTA:** "View Details →"

#### B2. Bulk Emissions Rejected
- **Same as B1** but red status badge + rejection comment callout

#### B3. Bulk Production Data Approved
- **Same as B1** but summary table shows **Product Name** instead of Category

#### B4. Bulk Production Data Rejected
- **Same as B2** but summary table shows **Product Name**

---

### Group C: Deadline Notifications (2 types)

#### C1. Deadline Reminder
- **Recipient:** Users who haven't submitted data
- **Sent:** 10th of every month at 8 AM (user's local timezone)
- **Subject:** "Data Submission Reminder — Carbon Lens"
- **Status badge:** ⏰ REMINDER (amber)
- **Body:** "You haven't submitted your emission data for {Month} {Year} for site {Site Name}. Please submit your data before the deadline."
- **Detail card fields:** Month, Year, Site
- **CTA:** "Submit Your Data →"
- **Tone:** Urgent but friendly — not punitive

#### C2. Escalation Email
- **Recipient:** Managers
- **Sent:** 15th of every month at 8 AM (manager's local timezone)
- **Subject:** "Pending Data Submissions — Carbon Lens"
- **Status badge:** ⚠️ ESCALATION (amber)
- **Body:** "The following users under your management have not submitted data for {Month} {Year}."
- **Pending users table:**
  ```
  | Name          | Email              | Role    | Site        |
  |---------------|--------------------|---------|-------------|
  | John Doe      | john@company.com   | User    | Dubai HQ    |
  | Priya Patel   | priya@company.com  | User    | Mumbai Plant|
  ```
- **CTA:** "View Dashboard →"
- **Tone:** Informational, professional — manager needs to follow up

---

## 5. Shared Content Blocks

### Header Banner
- Full-width emerald gradient (`#059669` → `#064e3b`)
- Logo (left or centered) + "Carbon Lens" text in white
- Height: ~80-100px
- Rounded top corners on the content card

### Status Badge
- Centered, pill-shaped or full-width banner
- **Approved:** Green background, white text, checkmark icon
- **Rejected:** Red background, white text, X icon
- **Reminder:** Amber background, dark text, clock icon
- **Escalation:** Amber background, dark text, warning icon

### Detail Card
- Gray background (`#f3f4f6`), rounded corners
- 2-column layout: label (muted) | value (bold)
- Thin border or no border (subtle)

### Rejection Callout
- Amber/yellow background (`#fffbeb`), amber border (`#fef3c7`)
- Lightning bolt or quote icon
- Manager's rejection comment as quoted text
- Only appears in rejection emails

### Action Trail
- Light background section
- Two rows: "Submitted by" and "Approved/Rejected by"
- Each shows: name, email, role (for manager)
- Builds trust — user sees exactly who took the action

### CTA Button
- Blue (`#2563eb`), white text
- Rounded corners (8px)
- Padding: 12px 32px
- Text: "View Details →" or "Submit Your Data →"
- Centered
- Links to the Carbon Lens app

### Footer
- Muted text, small font
- "© 2026 Carbon Lens"
- "Manage Notification Preferences" link (links to /settings page)
- Optional: company address for CAN-SPAM compliance

---

## 6. Technical Constraints for Email HTML

| Constraint | Requirement |
|-----------|-------------|
| **Max width** | 600px (email client standard) |
| **Layout** | Table-based (not flexbox/grid — email clients don't support them) |
| **CSS** | Inline styles only (no external stylesheets, no `<style>` in `<head>` for Outlook) |
| **Images** | Minimize — many clients block images by default. Logo is OK. Use HTML/CSS for icons |
| **Fonts** | System fonts only (`Arial, Helvetica, sans-serif`) — custom fonts don't work in email |
| **Responsive** | Single-column layout that works at 320px-600px. Use `max-width: 600px` on wrapper |
| **Dark mode** | Optional: `@media (prefers-color-scheme: dark)` for Apple Mail, Outlook.com. Gmail ignores it |
| **Buttons** | Use `<a>` with inline padding/background (not `<button>` — not supported in email) |
| **Border radius** | Supported in most clients except Outlook desktop (degrades gracefully to square) |
| **Emoji** | Can be used in status badges as fallback (✓, ✗, ⏰, ⚠️) |

---

## 7. Variable Placeholders

The designer should use these placeholders in mockups:

| Placeholder | Example Value | Used In |
|-------------|---------------|---------|
| `{name}` | "Ahmed" | All — greeting |
| `{categoryName}` | "Scope 1 - Electricity" | A1, A2 |
| `{productName}` | "Steel" | A3, A4 |
| `{siteName}` | "Dubai HQ" | A1-A4, C1 |
| `{comment}` | "Missing source documentation" | A2, A4, B2, B4 |
| `{totalCount}` | "12" | B1-B4 |
| `{month}` | "February" | C1, C2 |
| `{year}` | "2026" | C1, C2 |
| `{submitterName}` | "John Doe" | Action trail |
| `{submitterEmail}` | "john@company.com" | Action trail |
| `{managerName}` | "Sarah Khan" | Action trail |
| `{managerEmail}` | "sarah@company.com" | Action trail |
| `{managerRole}` | "Manager" | Action trail |
| `{viewDetailsUrl}` | Link to app | CTA button |
| `{settingsUrl}` | Link to /settings | Footer |

---

## 8. Testing Checklist for Email

After design, test rendering in:

- [ ] Gmail (web)
- [ ] Gmail (Android app)
- [ ] Gmail (iOS app)
- [ ] Outlook (desktop — Windows)
- [ ] Outlook.com (web)
- [ ] Apple Mail (macOS)
- [ ] Apple Mail (iOS)
- [ ] Yahoo Mail

Use [Litmus](https://litmus.com) or [Email on Acid](https://emailonacid.com) for cross-client testing.

---

## 9. Deliverables

- [ ] Base layout template (shared by all 10 types)
- [ ] 4 single approval/rejection templates (A1-A4)
- [ ] 4 bulk approval/rejection templates (B1-B4)
- [ ] 1 deadline reminder template (C1)
- [ ] 1 escalation template (C2)
- [ ] Mobile responsive version of each
- [ ] HTML source files (inline CSS, table-based layout)
