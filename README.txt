FOURNIX Diagnostic v1

Application PWA locale pour visites de diagnostic de structure et bâtiment.

Fonctions principales
- Projets de visite.
- Import PDF, images, DWG et DXF.
- Annotations vectorielles : crayon, ligne, flèche, rectangle, texte.
- Repères de pathologies.
- Photos prises sur site ou choisies dans la galerie, liées à un point du plan.
- Calibration et mesures.
- Notes de visite.
- Checklist diagnostic.
- Export d'un dossier ZIP de visite.
- Export de la page courante en PDF annoté.
- Sauvegarde de projet chiffrée avec mot de passe.
- Code PIN et chiffrement AES-GCM du stockage local.
- Verrouillage automatique.
- Installation sur Android / tablette comme application web.

Installation sur GitHub Pages
1. Créer un dépôt GitHub public, par exemple fournix-diagnostic.
2. Décompresser ce ZIP.
3. Importer index.html, styles.css, app.js, manifest.json, sw.js et les deux icônes à la racine du dépôt.
4. Settings > Pages.
5. Source : Deploy from a branch.
6. Branch : main.
7. Dossier : /(root).
8. Save.
9. Ouvrir l'adresse GitHub Pages sur le téléphone.
10. Android : navigateur > menu > Installer / Ajouter à l'écran d'accueil.

Sécurité
Les fichiers de projet, photos et données métier sont chiffrés dans IndexedDB avec une clé dérivée du PIN.
Les documents ne sont pas envoyés à un serveur applicatif.
Les bibliothèques JavaScript nécessaires sont chargées depuis des CDN publics lors du premier usage, puis mises en cache.

DWG / DXF
Le lecteur CAO est une fonctionnalité bêta reposant sur un parseur WebAssembly chargé dans le navigateur.
La prise en charge peut varier selon la version du DWG, les polices SHX, les objets propriétaires et la complexité du dessin.

Conseil d'usage
Créer régulièrement une sauvegarde chiffrée du projet depuis l'onglet Export.
