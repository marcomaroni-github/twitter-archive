# Twitter Archive Site

Turn the archive you downloaded from Twitter/X into a static website you can
publish anywhere — keeping your private data private.

Supported format: the Twitter archive as exported in April 2024.

## What you need

- [Node.js](https://nodejs.org) 18 or newer
- Your Twitter archive (`.zip`), requested from Twitter/X under
  *Settings → Your account → Download an archive of your data*

## Create your site

1. Download this project (green **Code** button → **Download ZIP**, then extract it) or clone it with git.
2. Copy your archive `.zip` into the `archive` folder. If Twitter split it into several zips, copy all of them.
3. Open a terminal in the project folder and run:

   ```
   npm install
   npm run build
   ```

4. Answer a few questions. Pressing Enter keeps the safe default.
5. Double-click `site/index.html` to check the result in your browser.
6. Publish the `site` folder (see [Publishing](#publishing)).

Your answers are saved in `config.json`: the next `npm run build` asks nothing.

The `site` folder is deleted and recreated on every build: do not add files to
it by hand. Put them in the `extra` folder instead: everything in it (except its
README) is copied into `site` on each build.

| Command | What it does |
|---|---|
| `npm run build` | Builds the site (asks questions only the first time) |
| `npm run build -- --reconfigure` | Asks the questions again |
| `npm run build -- --yes` | Never asks; uses `config.json` or the defaults |
| `npm run build -- --debug` | Shows technical details when something goes wrong |

## What gets published — and what doesn't

Published:
- Your own tweets and the replies you wrote in your own threads
- Their photos and videos (with location and camera data removed from images)
- Your name, username, bio, location, avatar and header as shown on your profile
- Retweets and replies to other users **only if you choose so** (default: no)

Never published, whatever you choose:
- Direct messages, email address, phone number, IP addresses
- Followers, following, likes, blocks, mutes, lists, ads data
- Deleted tweets
- The device you tweeted from and the location attached to tweets

The tool reads only the files it needs from the archive. If one of your tweets
contains your own email, phone number or IP address, that tweet is hidden; if
your bio or the website you chose contains one, that field is left empty. The
summary at the end tells how many tweets were hidden (never the values). As a
last safety net, after building it searches the site for your email, phone
number and IP addresses: if it finds any, it deletes the site and stops.

Mentions of other people (`@name`) inside your tweets are kept as they are,
because they were already public.

By default the site asks search engines not to index it. You can change this
during the setup.

## Publishing

The `site` folder is a plain static website: upload it anywhere.

- **GitHub Pages**: create a new repository, put the contents of `site` in it,
  then *Settings → Pages → Deploy from a branch*. GitHub rejects files over
  100 MB and recommends sites under 1 GB: the build warns you if you exceed them.
  For a custom domain, create a file `extra/CNAME` containing only your domain
  (e.g. `tweets.example.org`): it is copied into `site` on every build.
- **Netlify**: drag and drop the `site` folder on <https://app.netlify.com/drop>.
- **Your own server**: copy the contents of `site` to the web root.

Never publish the `archive` folder or `config.json`.

## Development

```
npm test
```

Tests run on a small fake archive in `test/helpers/fixture.js`, never on real data.
