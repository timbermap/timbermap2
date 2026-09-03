# models/

One folder per model/algorithm, numbered in creation order: `NNN_slug_or_name`.

```
models/
  001_conteo_copas/
    model.json              # links this folder to the DB row + GCS weights prefix
    01_notebooks_raw/       # raw dev notebooks (git-tracked)
    02_weights/             # empty locally — real files live in GCS, see sync_weights.sh
    03_sample_images/
      small/                # thumbnails for the model catalog page (git-tracked)
      large/                # feature-showcase images for the model detail page (git-tracked)
```

## Adding a new model

1. Create the DB row in `models` (superadmin panel, or directly) to get a `model_id`.
2. `mkdir -p models/NNN_slug/{01_notebooks_raw,02_weights,03_sample_images/{small,large}}`
   (NNN = next sequential number, 3 digits)
3. Copy `model.json` from an existing folder and fill in `model_id`, `name`, `slug`,
   `pipeline_type`, `runner` (path to the actual `workers/ml/runners/*.py` file, once it
   exists), `gcs_weights_prefix`.
4. Drop notebooks/sample images straight into git as normal.

## Weights (02_weights/)

Weight files (`.h5`, `.npy`, etc.) are **not committed to git** — they're tracked in the
`model_artifacts` DB table and stored in GCS under `gcs_weights_prefix`
(`gs://timbermap-data/models/{model_id}/...`), same bucket every other large asset in this
app already lives in. `02_weights/` stays empty in the repo (just a `.gitkeep`); use
`sync_weights.sh` to pull the real files down locally when you need them, or push local
changes back up.

```bash
./models/sync_weights.sh pull 001_conteo_copas   # GCS -> local 02_weights/
./models/sync_weights.sh push 001_conteo_copas   # local 02_weights/ -> GCS
```

Sample images (`03_sample_images/`) stay in git — they're normal web-sized images, not
worth the extra indirection.
