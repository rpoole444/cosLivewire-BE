# Venue Photo Maintenance

This workflow keeps imported calendar events from showing blank or broken images.

## What It Does

- Matches local venue image filenames or public image URLs to existing venue profiles.
- Finds imported events with missing, broken, or placeholder poster values.
- Repairs event posters with the venue profile image when possible.
- Falls back to the Alpine Groove Guide default event image when no venue image is available.
- Suggests lightweight shell venue profiles for repeated venue names that do not have a profile yet.

## Admin UI

Use:

```txt
/admin/venues/photos
```

The page supports:

- Dry scan with no writes.
- Selectable venue photo updates.
- Selectable event image repairs.
- Selectable shell venue candidates.
- Preview apply with no writes.
- Explicit confirmed apply.

Production note: Heroku cannot read files from your local `Downloads` folder. In production, paste public image URLs into the admin UI, or run the local script below with production database and S3 credentials.

## Scripts

Dry run:

```sh
npm run venue-photo:dry-run
```

Preview an apply plan:

```sh
npm run venue-photo:apply -- --approvals ./approvals.json
```

Execute an apply plan:

```sh
npm run venue-photo:apply -- --approvals ./approvals.json --execute
```

## Approval JSON

```json
{
  "venue_photo_updates": [
    {
      "profile_id": 123,
      "file_path": "/Users/reidpoole/Downloads/Black Sheep Logo.jpg"
    },
    {
      "profile_id": 456,
      "image_url": "https://example.com/venue-logo.jpg"
    }
  ],
  "event_image_repairs": [
    {
      "event_id": 789,
      "use_venue_image": true,
      "use_default": true
    }
  ],
  "shell_venues": [
    {
      "display_name": "Example Venue",
      "region": "colorado-springs"
    }
  ]
}
```

## Safety Rules

- Existing valid venue profile images are preserved unless `force` is set.
- Existing valid event posters are preserved unless `force` is set.
- `use_venue_image` repairs use the linked venue profile image first.
- `use_default` repairs use the Alpine Groove Guide default image when no better image exists.
- Shell venues are marked as shell/listed/approved placeholders so future imports can attach to them, but they do not overwrite user-owned profiles.

## Event Display Fallback Order

Public event views now receive `display_image_url` from the API. The backend resolves it in this order:

1. Event poster, if valid.
2. Linked venue profile image.
3. Import/source image, such as Moondog.
4. Alpine Groove Guide default event image.

Frontend views should prefer `display_image_url` and fall back to `poster`.
