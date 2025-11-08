# DESIGN_GUIDE.md — Wordtrim Web (Phase 1)

##  General Visual Style
**Reference:** [Figma Design File](https://www.figma.com/design/dMLIy2VaCLGZ5SY02qDY9A/Wordtrim---do-not-delete?node-id=1-4877)

### Color Palette
| Name | Usage | HEX |
|------|--------|------|
| Primary Blue | Buttons, highlights | `#4481fd` |
| Secondary Blue | Buttons, highlights | `#c7daff` |
| Light Gray | Borders | `#f5f6f9` |
| Dark Gray | muted text | `#8d96a9` |
| Success Green | Restore actions | `#28A745` |
| Danger Red | Remove actions | `#ff4d5b` |
| Background Primary | App background | `#FFFFFF` |
| Background Secondary | Video Player Component background | `#f5fafe` |
| Text Primary | Main text | `#253658` |
| Yellow | pro features | `#FFD94D` | 
---

### Typography
| Style | Font Family | Weight | Size | Usage |
|--------|--------------|---------|------|--------|
| semi-bold | Inter | 600 | 18px | header title |
| semi-bold | Inter | 600 | 14px | header text, Tip Model button text |
| semi-bold | Inter | 600 | 16px | header button text |
| bold | Inter | 700 | 20px | Tutorial Model Header |
| bold | Inter | 700 | 16px | Tip Model Header |
| regular | Inter | 400 | 24px | word chip text |
| regular | Inter | 400 | 14px | Tip Model text |
| medium | Inter | 500 | 12px | timestamps |
| regular | Inter | 400 | 10px |  Tooltips text |

---

### Spacing & Layout
- Base unit: `8px`
- Card padding: `16px`
- Button height: `40px`
- Timeline height: `60px`
- Modal width: `480px`

---

## Component Library Summary

### Button (`wt-button`)
- Variants: `primary`, `secondary`, `danger`, `ghost`
- States: `default`, `hover`, `disabled`
- Corners: `border-radius: 8px`
- Shadow: subtle drop shadow (`0px 1px 2px rgba(0,0,0,0.1)`)

---

### Word Chip (`wt-word-chip`)
- Padding: `3px 5px`
- Border radius: `10px`
- Gap: `5px`
- Visual states:
  - Normal → Light Gray background, Text Primary text
  - Selected (Start/End) → Primary Blue background, white text
  - Selected (range) → Secondery Blue background, Primary Blue text
  - Deleted → red text with strikethrough

---

### Timestamp (`wt-timestamp`)
- Padding: `1px 4px`
- Border radius: `6px`
- Gap: `1px`

---

### Timeline (`wt-timeline`)
- Background:  Light Gray
- Unelected region: blue translucent overlay
- Handles: `8px 49px` with Border radius `4px` draggable rectangle

---

### Action Bar (`wt-action-bar`)
- Fixed bottom
- Border-top: `1px`
- Border-left: `1px`
- Pading: `16px 0 16px 16px`
- Button group evenly spaced horizontaly

---

### Action Bar Item (`wt-action-bar-item`)
- Fixed size: `70px`
- Border radius: `12px`
- Pading: `6px`
- Icon size: `32px`
---

### Video Player (`wt-video-player`)
- Aspect ratios: `16:9`, `1:1`, `9:16` (auto-detect)
- Rounded corners: `20px`
- Controls: play/pause, seek, mute
- Frame border: subtle shadow

---

### Editing Tip Modal (`wt-tip-modal`)
- Trigger: appears on initial load
- Fixed size: `326px 153px`
- Border: Primary Blue `1px` radius `10px`
- Padding: `16px`
- Background overlay: Primary Blue background with white text

---

### Tutorial Modal (`wt-tutorial-modal`)
- Trigger: appears after clicking the Tutorial button on the Action Bar or via the Editing Tip Modal
- Fixed size: `500px 355.49px`
- Border radius: `15px`
- Padding: `20px`
- Vidoe Tutorial Layout: size `460px 259.49px` Border radius `10px`
- Background overlay: white background with Text Primary text

---

### Icons
| Usage | Icon | Library |
|--------|------|----------|
| Play / Pause | ▶️ ⏸️ | svg |
| Undo / Redo | ↩️ ↪️ | svg |
| Close | ✖️ | svg |

---

### States & Animations
- Hover transitions: `0.2s ease-in-out`
- Button press: small scale-down (`transform: scale(0.98)`)
- Modal fade-in/out: `opacity 0.3s ease`

---

### Responsive Behavior
- Minimum width: 360px
- Mobile layout: stack timeline and action bar vertically
- Tablet/Desktop: horizontal timeline, fixed bottom action bar

---

### Accessibility
- Ensure all buttons have `aria-label`.
- Use `role="button"` for custom elements.
- Focus outline color: `#007BFF`.

---

*(Add any Figma-specific notes or screenshots here if you want Cursor to “understand” spacing and style better.)*
