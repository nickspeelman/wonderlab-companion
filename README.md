# Wonder Lab Companion Frontend — Redirect Authentication

Static GitHub Pages frontend for the Wonder Lab Companion.

## Configure

Edit `js/config.js`:

- `googleClientId`: OAuth Web Client ID
- `backendUrl`: deployed Apps Script `/exec` URL

## Google OAuth client

In the Google Cloud OAuth Web Client:

1. Add `https://wonderlab-companion.nickspeelman.com` under **Authorized JavaScript origins**.
2. Add the exact Apps Script login URL under **Authorized redirect URIs**:

   `YOUR_APPS_SCRIPT_EXEC_URL`

The Companion asks the backend for a short-lived login challenge. Google includes that challenge in the verified ID token's `nonce` claim and posts the credential directly to Apps Script. Apps Script then returns the browser to the Companion with a one-time code in the URL fragment.

## Deploy

Commit this directory to the GitHub Pages repository.

The dashboard remains on the custom domain. During sign-in, the browser briefly visits Google and Apps Script before returning to the Companion.

## Picture Library step

The Companion now supports:

- listing active Picture Library entries;
- resizing JPEG, PNG, and WebP images locally;
- uploading a picture with one spoken label;
- deleting an entry and moving its Drive file to Trash.

Images are reduced to a maximum 1200-pixel dimension before upload. A separate small JPEG thumbnail is stored with the metadata so Drive files do not need to be made public.
