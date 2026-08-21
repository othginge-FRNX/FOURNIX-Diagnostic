FOURNIX FieldDiag v3

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


Nouveautés V3
- Thème FOURNIX orange avec dégradés.
- Forme assistée enrichie : cercle, ellipse, rectangle, carré, triangle, losange, pentagone, hexagone, octogone et reconnaissance automatique.
- Choix forcé d'une forme quand la reconnaissance automatique n'est pas souhaitée.
- Outil Sélection pour choisir une forme et modifier son échelle de 25 % à 300 %.
- Suppression directe de l'objet sélectionné.
- Outil Gomme visible et utilisable en glissant sur les annotations.
- Suppression de l'assistant d'écriture manuscrite.
- Texte avec taille réglable, gras et fond lisible.
- Photos, vidéos, audios, fissures et fonctions de visite conservés.


Nouveauté V4 — Préparation intervention
- Nouvelle fiche technicien.
- Génération automatique locale à partir de la pré-visite, du compte rendu et des constats.
- Liste de matériel, EPI, consommables, accès et contraintes.
- Détection par règles de besoins courants : sondages destructifs, Ferroscan / pachomètre, carottage, fissures, humidité, déformations, accès en hauteur, alimentation électrique, eau, bâtiment occupé, risques avant sondages.
- Quantité, disponibilité, note et case « préparé » pour chaque élément.
- Ajout manuel d'éléments.
- Points critiques signalés.
- Export PDF de la fiche technicien.
- La fiche technicien est aussi ajoutée au ZIP du dossier de visite en PDF, CSV et JSON.
- Aucun service IA payant n'est nécessaire pour cette génération.


Nouveauté V5 — Compte rendu de visite en PDF
- Bouton « Compte rendu PDF » directement dans l'onglet Compte rendu.
- Le PDF est lisible sur Android, tablette et ordinateur.
- Une copie du PDF est enregistrée dans le stockage local chiffré de l'application.
- Le PDF contient les informations du projet, les personnes présentes, zones visitées,
  conditions d'accès, sondages, constats, limites, actions, suite à donner et notes libres.
- Les observations enregistrées sur les plans sont reprises dans le PDF.
- L'export complet de la mission contient automatiquement « compte_rendu_visite.pdf ».
- Les fichiers JSON restent présents pour la sauvegarde technique, mais il n'est plus nécessaire
  de les ouvrir pour lire le compte rendu sur le téléphone.


Nouveauté V6 — Navigation
- Deux boutons permanents en haut de l'application : ← Retour et → Avancer.
- Le bouton Retour ramène à l'écran précédent dans FOURNIX FieldDiag.
- Le bouton Avancer permet de revenir à l'écran quitté après un retour.
- La navigation mémorise l'accueil, les projets, les onglets, les plans ouverts et les pages PDF.


Nouveauté V7 — identité visuelle
- Icône de l'application mise à jour en orange.
- Nouveau style visuel de l'icône plus aligné avec FOURNIX FieldDiag.
- Une planche de propositions de logo est fournie séparément.


Identité officielle V8
- Nom : FOURNIX FieldDiag
- Signature : Assistant terrain pour l’ingénieur structure
- Nom court sur téléphone : FieldDiag
- Monogramme : FD
- Palette : orange
- Les identifiants de stockage local restent identiques pour préserver les projets déjà créés.


V9 — améliorations terrain et DWG
- Photos sur plan : flèche de direction de prise de vue avec angle réglable.
- Bouton ↶ permanent dans la barre supérieure du lecteur : annule immédiatement la dernière annotation.
- La gomme et le bouton Supprimer sont conservés.
- Nouveau lecteur DWG « Espace objet » : fond sombre, pan/zoom, vue automatique, vue DWG enregistrée, extents complets et fond sombre/clair.
- Le moteur CAD avancé utilise un rendu WebGL/Canvas local dans le navigateur.
- Un bouton « Annoter » permet de revenir au convertisseur SVG historique pour poser les annotations sur DWG.
- Le convertisseur SVG reste un mode de secours, car il ne prend pas en charge tous les objets AutoCAD.
- Barre de pages PDF revue pour téléphone : Préc., Suiv. et PDF annoté tiennent sur la largeur de l'écran.


V10 — correctif ouverture de fichiers
- Correction du cache PWA pour éviter qu'un ancien app.js soit mélangé avec un nouvel index.html.
- PDF et images repassent systématiquement par le lecteur stable.
- DWG/DXF s'ouvrent par défaut avec le lecteur d'annotation historique.
- Le mode « Espace objet bêta » reste disponible séparément.
- Correction des chemins WebAssembly/worker du lecteur CAD avancé.
- Les requêtes .js/.wasm ne reçoivent plus index.html comme réponse de secours.
- Mise à jour du service worker demandée automatiquement au lancement.


Si une ancienne version reste bloquée après la mise à jour :
- Ouvrir l'adresse du site suivie de /reset-cache.html
- Appuyer sur « Actualiser l'application »
- Cette opération efface uniquement les caches techniques et service workers.
- Elle ne supprime pas les projets stockés dans IndexedDB.


V11 — correctif ouverture et annotation
- Badge V11 visible en haut de l'application.
- Le lecteur s'ouvre immédiatement au clic sur « Ouvrir et annoter ».
- Vérification de la présence du fichier chiffré avant lecture.
- Les nouveaux imports sont relus après enregistrement avant d'apparaître dans le projet.
- Les écritures IndexedDB attendent la fin réelle de la transaction.
- Si un ancien document est manquant ou illisible, FieldDiag affiche une erreur claire.
- Bouton « Réimporter ce fichier » pour réparer un document sans supprimer le projet.
- PDF.js dispose de plusieurs sources de secours.
- LibreDWG dispose de plusieurs sources de secours.
- L'ouverture des fichiers utilise aussi une délégation d'événement de secours.
