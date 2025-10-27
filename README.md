# SNHU Map — Places You've Been

This is a little project for lab 2 that allows the user to explore SNHU's campus map and learn some info about the various places there.

React + Leaflet app to click the map, add places (title/years/notes), view a live list, and show popups. Includes edit/delete, toggle list, save/load JSON, and optional reverse-geocoding.

## Controls & Behavior

### Header Controls

- **Show/Hide List**  
  Toggles the left sidebar that lists all entered locations and their info.
- **Done**  
  Stops prompting for new locations from map clicks. The list auto-hides; markers remain and popups still work.  
  _Tip:_ Press **Show List** again if you want to view/edit after Done.
- **Reset**  
  Clears all locations and restores the app to collecting mode. Reopens the list panel.
- **Save JSON**  
  Downloads all current locations as `locations.json` (portable backup).
- **Load JSON**  
  Imports a previously saved JSON file and repopulates the map and list.
  - On success: shows a success banner.
  - On invalid file: shows an error banner.
  - You can re-import the exact same file multiple times.

### Map Interactions

- **Click map (Collecting mode only)**  
  Opens the **Add Location** modal prefilled with the clicked latitude/longitude.
- **Marker click**  
  Opens a popup showing the title, years, optional reverse-geocoded display name, and notes.

### Modal (Add/Edit Location)

- **Title**: Free text (e.g., “Lived here”).  
- **Years**: Free text (e.g., “2018–2022”).  
- **Notes**: Any details (favorite restaurant, memory, etc.).  
- **Save**: Saves the location; if reverse-geocoding succeeds, city/display name is attached.  
- **Cancel**: Discards changes and closes the modal.

### Sidebar List (when visible)

Each item shows:

- **Title** + **Years** badge (if provided).
- **Display Name** from reverse-geocoding (or raw lat/lng).
- **Notes** (if provided).

Actions per item:

- **Edit**: Opens the modal with existing values.  
- **Delete**: Removes that location.  
- **Center**: Pans/zooms map to that marker.

### Modes

- **Collecting** (default): Map clicks add locations; list is visible.  
- **Done**: Map clicks no longer add; list auto-hides; markers/popup viewing still allowed.  
- **Reset**: Clears everything and returns to Collecting.

### Data Persistence

- **Local Storage**: The app auto-saves your locations between reloads.  
- **Save/Load JSON**: Export/import your data for backup or sharing.

