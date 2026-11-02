# Rollback point: product photos on white backgrounds (2026-11-02)

The state of every product photo before the photographed products were moved from a pure white background to the storefront's
off-white (`#F4F2ED`), the colour of the 22 starter products. Git tag: `images-white-backgrounds-2026-11-02`.

What was saved:

- `restore-images.sql`: for all 98 products, which photos they use (`images`, `image_labels`), and for all 386 library photos their
  `web_path` / `thumb_path`. Taken from the live database.
- The tag holds the photo files themselves (`public/media/`, 720 images on white).

## Going back

New photos get new file names, so the white ones are never overwritten and are still on the site. Going back is only a matter of
pointing the products at them again:

```bash
cd server
npm run images:rollback -- restore white-backgrounds-2026-11-02 --dry-run   # shows how many rows it would change; changes nothing
npm run images:rollback -- restore white-backgrounds-2026-11-02
```

The site shows the old photos within about a minute (the API keeps the catalogue in memory that long).

If the white photo files have been deleted since (`products:import -- --prune`), bring them back first:

```bash
git checkout images-white-backgrounds-2026-11-02 -- public/media
git commit -m "Restore the white-background photo files" && git push
```

and run the restore command above once the deployment has finished.

Only photo columns are touched: prices, stock, names, descriptions and visibility stay as they are now.
