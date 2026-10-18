-- =====================================================================
-- DUNK — menu réel (repris de dunk.ma), photos optimisées, coordonnées
-- =====================================================================
do $$
declare
  img text := 'https://mjrnlrmefyxcuvzzwifl.supabase.co/storage/v1/object/public/menu/dunk/opt/';
  c_menu uuid; c_burgers uuid; c_sides uuid; c_desserts uuid; c_drinks uuid;
  p_menu uuid; p_xl uuid; p_l uuid; p_m uuid; p_mozza uuid; p_redvelvet uuid; p_coca uuid; p_citron uuid;
  g_size uuid; g_sauce uuid; g_toppings uuid;
begin
  -- On repart d'un menu propre (les anciennes commandes gardent leurs libellés)
  delete from product_option_groups;
  delete from options;
  delete from option_groups;
  delete from products;
  delete from categories;

  insert into categories (name, description, position) values ('Menu', 'Le classique Dunk', 1) returning id into c_menu;
  insert into categories (name, description, position) values ('Smash Burgers', 'Steaks smashés minute, cheddar fondu, toppings offerts', 2) returning id into c_burgers;
  insert into categories (name, description, position) values ('Sides', null, 3) returning id into c_sides;
  insert into categories (name, description, position) values ('Desserts', null, 4) returning id into c_desserts;
  insert into categories (name, description, position) values ('Boissons', null, 5) returning id into c_drinks;

  insert into products (category_id, name, description, price, compare_at_price, image_url, badge, featured, position) values
    (c_menu, 'The Original Dunk Menu', 'Le classique Dunk : 2, 3 ou 4 steaks smashés, cheddar fondu, toppings offerts et sauce maison au choix.', 70, 79, img || 'product-1791969887135.jpg', 'Best-seller', true, 1)
    returning id into p_menu;
  insert into products (category_id, name, description, price, compare_at_price, image_url, badge, featured, position) values
    (c_burgers, 'XL — 4 patties', '4 steaks smashés, cheddar, toppings offerts et sauce maison au choix.', 90, 99, img || 'product-1791970123091.jpg', 'XL', true, 1)
    returning id into p_xl;
  insert into products (category_id, name, description, price, compare_at_price, image_url, position) values
    (c_burgers, 'L — 3 patties', '3 steaks smashés, cheddar, toppings offerts et sauce maison au choix.', 80, 89, img || 'product-1791970188509.jpg', 2)
    returning id into p_l;
  insert into products (category_id, name, description, price, compare_at_price, image_url, position) values
    (c_burgers, 'M — 2 patties', '2 steaks smashés, cheddar, toppings offerts et sauce maison au choix.', 70, 79, img || 'product-1789154290467.jpg', 3)
    returning id into p_m;
  insert into products (category_id, name, description, price, compare_at_price, image_url, featured, position) values
    (c_sides, 'Mozzarella Sticks (x4)', 'Mozzarella maison, panure croustillante et cheese pull indécent.', 35, 45, img || 'product-1789067613666.jpg', true, 1)
    returning id into p_mozza;
  insert into products (category_id, name, price, image_url, position) values
    (c_desserts, 'Matilda Cake', 39, img || 'product-1789068123363.jpg', 1);
  insert into products (category_id, name, price, image_url, position) values
    (c_desserts, 'Red Velvet', 39, img || 'product-1789068129198.jpg', 2) returning id into p_redvelvet;
  insert into products (category_id, name, price, image_url, position) values
    (c_desserts, 'Salted Caramel Chocolate Cake', 39, img || 'product-1789068139800.jpg', 3);
  insert into products (category_id, name, price, image_url, position) values
    (c_drinks, 'Coca-Cola', 20, img || 'product-1789153553455.jpg', 1) returning id into p_coca;
  insert into products (category_id, name, price, image_url, position) values
    (c_drinks, 'Coca-Cola Zero', 20, img || 'product-1789153604607.jpg', 2);
  insert into products (category_id, name, price, image_url, position) values
    (c_drinks, 'Poms', 20, img || 'product-1789153580054.jpg', 3);
  insert into products (category_id, name, price, image_url, position) values
    (c_drinks, 'Hawaï', 20, img || 'product-1789153622040.jpg', 4);
  insert into products (category_id, name, price, image_url, position) values
    (c_drinks, 'Sidi Ali', 20, img || 'product-1789153594640.jpg', 5);
  insert into products (category_id, name, price, image_url, position) values
    (c_drinks, 'Citronnade maison', 25, img || 'product-1789154340546.jpg', 6) returning id into p_citron;

  -- Groupes d'options
  insert into option_groups (name, internal_name, min_select, max_select, position) values
    ('Combien de steaks ?', 'Taille Original Dunk Menu', 1, 1, 1) returning id into g_size;
  insert into options (group_id, name, price, position) values
    (g_size, 'M — 2 steaks', 0, 1), (g_size, 'L — 3 steaks', 10, 2), (g_size, 'XL — 4 steaks', 20, 3);

  insert into option_groups (name, internal_name, min_select, max_select, position) values
    ('Ta sauce maison', 'Sauces maison', 1, 1, 2) returning id into g_sauce;
  insert into options (group_id, name, price, position) values
    (g_sauce, 'Sauce Dunk', 0, 1), (g_sauce, 'BBQ', 0, 2), (g_sauce, 'Mayo épicée', 0, 3), (g_sauce, 'Algérienne', 0, 4), (g_sauce, 'Ketchup', 0, 5);

  insert into option_groups (name, internal_name, min_select, max_select, position) values
    ('Toppings offerts', 'Toppings offerts', 0, 6, 3) returning id into g_toppings;
  insert into options (group_id, name, price, position) values
    (g_toppings, 'Cornichons', 0, 1), (g_toppings, 'Oignons', 0, 2), (g_toppings, 'Oignons caramélisés', 0, 3),
    (g_toppings, 'Salade', 0, 4), (g_toppings, 'Tomate', 0, 5), (g_toppings, 'Jalapeños', 0, 6);

  insert into product_option_groups (product_id, group_id, position) values
    (p_menu, g_size, 1), (p_menu, g_sauce, 2), (p_menu, g_toppings, 3),
    (p_xl, g_sauce, 1), (p_xl, g_toppings, 2),
    (p_l, g_sauce, 1), (p_l, g_toppings, 2),
    (p_m, g_sauce, 1), (p_m, g_toppings, 2);

  -- Code de démo désactivé (à toi de décider de tes offres)
  update promo_codes set active = false where code = 'DUNK15';

  -- Coordonnées, logo, horaires, ventes additionnelles
  update settings set data = jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(data,
    '{restaurant}', (data->'restaurant') || jsonb_build_object(
      'name', 'Dunk - Smash Burgers',
      'tagline', 'Steaks smashés minute, cheddar fondu, toppings offerts et sauces maison.',
      'phone', '+212 6 44 72 75 72',
      'whatsapp', '+212 6 44 72 75 72',
      'address', '21 rue Ibn Hamdis',
      'logo_url', img || 'logo-1789984604193.png')),
    '{hours}', '[
      {"day": 1, "open": "12:00", "close": "00:00", "closed": false},
      {"day": 2, "open": "12:00", "close": "00:00", "closed": false},
      {"day": 3, "open": "12:00", "close": "00:00", "closed": false},
      {"day": 4, "open": "12:00", "close": "00:00", "closed": false},
      {"day": 5, "open": "12:00", "close": "00:00", "closed": false},
      {"day": 6, "open": "12:00", "close": "00:00", "closed": false},
      {"day": 0, "open": "12:00", "close": "00:00", "closed": false}]'::jsonb),
    '{marketing,announcement_enabled}', 'false'::jsonb),
    '{marketing,upsell_product_ids}', jsonb_build_array(p_mozza, p_citron, p_redvelvet, p_coca)),
    '{marketing,announcement_text}', '"🍔 À toi de jouer ! Commande en ligne, livraison ou à emporter"'::jsonb)
  where id = 1;
end $$;

-- Nettoyage de la table temporaire utilisée pour l'import des images
drop table if exists public.tmp_previews;
