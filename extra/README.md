# Extra files for your site

The `site` folder is deleted and recreated on every `npm run build`, so any
file you add there by hand is lost.

Put those files here instead: every file and subfolder in this folder
(except this README) is copied into `site` on each build.

Example: for a custom domain on GitHub Pages, create a file named `CNAME`
(no extension) containing only your domain, e.g. `tweets.example.org`.

Everything in this folder except this README is ignored by git.
