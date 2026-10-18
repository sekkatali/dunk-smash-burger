# Dunk Smash Burger — site de commande + back-office

React (Vite) · Supabase · déployable sur Vercel.

## Pages

**Site client** (`/`)
- Menu par catégories, produits mis en avant, fiche produit avec options (obligatoires / facultatives, avec ou sans supplément)
- Panier, ventes additionnelles, barre « livraison offerte »
- Commande (`/commande`) : livraison ou à emporter, zones de livraison, code promo, paiement espèces / TPE à la livraison / carte en ligne CMI
- Suivi de commande en direct (`/suivi/:id`)

**Back-office** (`/admin`)
| Page | Contenu |
|---|---|
| Commandes | Tableau en temps réel (Nouvelles → En cuisine → Prêtes → En livraison), sonnerie + notification, ticket imprimable, historique, export CSV |
| Produits | Produits, catégories, groupes d'options associables à certains produits seulement, photos, stock, ordre |
| Livreurs | Flotte, assignation, lien personnel par livreur (`/livreur/:lien`), espèces à remettre et solde |
| Statistiques | CA, commandes, panier moyen, visiteurs, conversion, tunnel, heures, sources (UTM), top produits/options, zones, promos |
| Marketing | Codes promo, bannière, mise en avant, ventes additionnelles, fichier clients (segments, export, audience Meta, WhatsApp), pixels Meta/GA4/TikTok, liens UTM + QR code |
| Paiement | Moyens de paiement, configuration CMI (CIH), caisse du jour |
| Paramètres | Restaurant, ouverture/fermeture instantanée, livraison, horaires, zones, équipe |

## Base de données
Migrations dans `supabase/migrations` (à appliquer dans l'ordre). Les prix sont recalculés côté serveur (`place_order`), le client ne peut pas les modifier. Le premier compte créé sur `/admin/login` devient propriétaire.

## Paiement CMI
Fonctions `supabase/functions/cmi-init` et `cmi-callback` (à déployer avec `verify_jwt = false`). Secret à définir : `CMI_STORE_KEY`. Le Client ID se saisit dans Paiement.

## Développement
```bash
npm install
npm run dev
```
Variables optionnelles : `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (sinon les valeurs du projet DUNK APP sont utilisées).
