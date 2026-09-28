# Tresse

Tresse fusionne les journaux de plusieurs services sur une seule ligne de temps, directement dans le navigateur.

Pendant un incident, on ouvre souvent cinq terminaux (nginx, l'API, un worker, la base…) et on essaie de recoller
les morceaux à la main, avec des formats d'heure différents, des fuseaux différents et des horloges qui dérivent.
Les plateformes d'observabilité règlent ce problème à condition que tout y soit déjà envoyé. Tresse le règle avec
ce que vous avez sous la main : des fichiers ou du texte copié depuis un terminal.

## Ce que fait l'outil

- **Détection automatique du format** de chaque source : ISO 8601, Apache/Nginx, JSON par ligne
  (pino, bunyan, logrus, zap…), syslog BSD, klog/glog (Kubernetes), Redis, JJ/MM/AAAA, timestamps Unix, heure seule
  (avec gestion du passage à minuit).
- **Fuseaux** : lus dans les lignes quand ils y sont, sinon réglables par source.
- **Décalage d'horloge** par source, à la milliseconde, ou par calage : on choisit une ligne comme T0, puis la ligne
  d'une autre source qui correspond au même instant, et Tresse calcule le décalage.
- **Fils communs** : les identifiants présents dans au moins deux sources (UUID, request id, `ord_…`, `trace_id=…`,
  IP) sont repérés automatiquement. Cliquer sur un fil montre son parcours d'un service à l'autre et peut
  filtrer le journal sur ce seul fil.
- **La tresse** : une frise de densité par source, avec les erreurs marquées en rouge. On la glisse pour isoler une
  plage et on la clique pour y sauter.
- Lignes multi-lignes (stack traces) rattachées à leur entrée, trous d'activité signalés, recherche texte ou
  `/regex/`, filtres par niveau, heure relative à T0, copie ou téléchargement de la vue fusionnée.
- Liste virtualisée : plusieurs centaines de milliers de lignes restent fluides.

Rien ne quitte le navigateur : aucun serveur, aucune dépendance, aucun envoi réseau (hormis les polices Google Fonts,
facultatives).

## Lancer

Ouvrir `index.html` dans un navigateur, ou servir le dossier :

```sh
python3 -m http.server 8000
# puis http://localhost:8000
```

Un exemple d'incident (paiements bloqués par un verrou PostgreSQL, horloge du worker en retard de 1,8 s) est chargé
au démarrage. Il est retiré dès que vous ajoutez vos propres journaux.

## Ajouter des journaux

- Glisser-déposer un ou plusieurs fichiers (une source par fichier).
- Coller du texte n'importe où sur la page (`Ctrl+V`).
- Bouton « Ajouter des journaux » pour nommer la source et choisir son fuseau.

## Raccourcis

| Touche | Action |
| --- | --- |
| `/` | Rechercher |
| `↑` `↓` ou `j` `k` | Ligne précédente / suivante |
| `n` / `Maj+n` | Erreur suivante / précédente |
| `t` ou double-clic | Définir la ligne comme T0 |
| `Échap` | Fermer le fil, puis la plage, puis la sélection |
| `Alt+clic` sur un niveau | N'afficher que ce niveau |

## Fichiers

- `parser.js` : détection des formats, niveaux et identifiants (fonctionne aussi sous Node/Bun)
- `app.js` : interface, fusion, liste virtualisée, tresse
- `demo.js` : génération du jeu d'exemple
- `style.css`, `index.html`
- `build.py` : génère `index-full.html`, une version autonome en un seul fichier (`python3 build.py`)
