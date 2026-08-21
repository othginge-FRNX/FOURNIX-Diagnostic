FOURNIX DIAG v2

Application terrain gratuite pour diagnostic de structure et bâtiment.

Nouveautés v2
- Pré-visite : questionnaire client avec rappels amiante / plomb selon l'année du bâtiment.
- Types de mission : pré-visite, diagnostic, expertise, suivi.
- Compte rendu de visite structuré et pré-remplissage automatique local.
- Symboles différents pour chaque pathologie.
- Outil Tracer fissure pour dessiner la trajectoire exacte d'une fissure.
- Photo, vidéo et note audio attachées à un point du plan.
- Transcription audio locale gratuite avec Whisper Tiny, téléchargé au premier usage.
- Assistance dessin : cercle/ellipse, rectangle et triangle reconnus à partir d'un croquis.
- Écriture manuscrite vers texte avec OCR local Tesseract, fonction bêta.
- Zoom jusqu'à 20x. Les annotations restent vectorielles. Le rendu PDF est plafonné en pixels pour éviter de bloquer le téléphone.
- Compression des photos avant stockage.
- Export ZIP avec plans, médias, questionnaire, compte rendu, observations CSV et notes.
- Stockage chiffré AES-GCM avec PIN, verrouillage automatique et sauvegarde chiffrée.

Coût
Aucune API payante, aucun abonnement technique requis pour cette version. GitHub Pages suffit pour l'hébergement.

Installation
1. Décompresser le ZIP.
2. Sur le dépôt GitHub FOURNIX-Diagnostic, remplacer index.html, styles.css, app.js, manifest.json, sw.js, README.txt et les icônes.
3. GitHub Pages doit rester sur main / (root).
4. Attendre le redéploiement puis actualiser l'application sur le téléphone.

Rappels intégrés
- Amiante : la pré-visite attire l'attention pour les bâtiments antérieurs à 1997 et demande DTA / repérage avant sondages.
- Plomb : la pré-visite attire l'attention pour les bâtiments antérieurs à 1949.
Ces rappels servent de checklist métier et ne remplacent pas l'analyse réglementaire de la mission.

DWG / DXF
Lecture locale bêta avec LibreDWG WebAssembly. Selon la version DWG, les polices SHX ou les objets propriétaires, l'affichage peut être incomplet.
