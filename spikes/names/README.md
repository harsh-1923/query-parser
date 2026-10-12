# names

Seeded person-name pool from public, permissively licensed sources, split into disjoint
train/test pools (80/20 per origin). Used by S3 and later by `@qp/datagen`.

```sh
npm install
./fetch-sources.sh            # ByteBaker/indian-names lists (BSD-3-Clause)
node build-names.mjs 42 > out/names.json
```

Sources: [ByteBaker/indian-names](https://github.com/ByteBaker/indian-names) (BSD-3-Clause) for
modern Indian names, and `@faker-js/faker` (MIT) locale data for en_IN and Latin-script locales.
`philipperemy/name-dataset` was considered and rejected: it's derived from the 2021 Facebook
account leak.

Same seed → byte-identical output (checked with sha1).
