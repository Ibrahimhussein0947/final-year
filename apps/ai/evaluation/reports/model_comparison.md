# Embedding model comparison (multilingual occupation probe)

AUC with bootstrap 95% interval over the 16 occupations. **Overlapping intervals mean the difference is not distinguishable from noise.** Amharic / Afaan Oromo phrases are not native-reviewed; this is a shortlist tool, not a verdict.

| Model | dim | ms/text | English | Amharic | Afaan Oromo | English -> Amharic | English -> Afaan Oromo |
|---|---|---|---|---|---|---|---|
| paraphrase-multilingual-MiniLM-L12-v2 | 384 | 60.5 | 0.983 [0.96-1.00] | 0.772 [0.62-0.89] | 0.755 [0.62-0.88] | 0.827 [0.70-0.93] | 0.571 [0.44-0.70] |
| paraphrase-multilingual-mpnet-base-v2 | 768 | 81.0 | 0.998 [0.99-1.00] | 0.684 [0.56-0.81] | 0.772 [0.65-0.88] | 0.842 [0.70-0.95] | 0.485 [0.35-0.63] |
| multilingual-e5-small | 384 | 68.5 | 0.936 [0.88-0.99] | 0.718 [0.58-0.87] | 0.802 [0.73-0.92] | 0.898 [0.84-0.96] | 0.731 [0.60-0.86] |
| LaBSE | 768 | 153.9 | 0.995 [0.99-1.00] | 0.931 [0.83-0.99] | 0.915 [0.83-0.98] | 0.964 [0.93-1.00] | 0.571 [0.38-0.74] |
| multilingual-e5-base | 768 | 135.9 | 0.923 [0.86-0.98] | 0.716 [0.59-0.85] | 0.786 [0.69-0.91] | 0.846 [0.70-0.96] | 0.749 [0.63-0.88] |

Top-1 accuracy (the true paraphrase is the single closest candidate):

| Model | English | Amharic | Afaan Oromo | English -> Amharic | English -> Afaan Oromo |
|---|---|---|---|---|---|
| paraphrase-multilingual-MiniLM-L12-v2 | 0.88 | 0.25 | 0.38 | 0.56 | 0.19 |
| paraphrase-multilingual-mpnet-base-v2 | 1.00 | 0.19 | 0.56 | 0.62 | 0.19 |
| multilingual-e5-small | 0.88 | 0.44 | 0.88 | 0.69 | 0.38 |
| LaBSE | 0.94 | 0.62 | 0.81 | 0.88 | 0.25 |
| multilingual-e5-base | 0.88 | 0.50 | 0.62 | 0.69 | 0.44 |
