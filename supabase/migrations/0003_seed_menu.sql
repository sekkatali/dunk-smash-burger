-- =====================================================================
-- DUNK SMASH BURGER — menu de démonstration (modifiable depuis /admin/produits)
-- =====================================================================
do $$
declare
  c_burgers uuid; c_chicken uuid; c_sides uuid; c_drinks uuid; c_desserts uuid;
  p_rookie uuid; p_dunk uuid; p_slam uuid; p_buzzer uuid; p_alley uuid; p_crossover uuid;
  p_fries uuid; p_cheesefries uuid; p_tenders uuid; p_rings uuid;
  p_coca uuid; p_fanta uuid; p_sprite uuid; p_water uuid;
  p_cookie uuid; p_shake uuid;
  g_steaks uuid; g_extras uuid; g_sauces uuid; g_remove uuid; g_menu uuid; g_menu_drink uuid;
  g_fries_sauce uuid; g_shake uuid; g_tenders_sauce uuid;
begin
  if exists (select 1 from categories) then return; end if;

  insert into categories (name, description, position) values ('Smash Burgers', 'Steaks smashés minute sur la plancha, bien croustillants', 1) returning id into c_burgers;
  insert into categories (name, description, position) values ('Chicken', 'Poulet crispy mariné 24h', 2) returning id into c_chicken;
  insert into categories (name, description, position) values ('Sides', 'Pour accompagner', 3) returning id into c_sides;
  insert into categories (name, description, position) values ('Boissons', null, 4) returning id into c_drinks;
  insert into categories (name, description, position) values ('Desserts', null, 5) returning id into c_desserts;

  insert into products (category_id, name, description, price, badge, featured, position) values
    (c_burgers, 'The Rookie', 'Steak smashé, cheddar fondu, oignons, cornichons, sauce Dunk', 45, null, false, 1) returning id into p_rookie;
  insert into products (category_id, name, description, price, badge, featured, position) values
    (c_burgers, 'The Dunk', 'Double steak smashé, double cheddar, oignons caramélisés, cornichons, sauce Dunk', 62, 'Best-seller', true, 2) returning id into p_dunk;
  insert into products (category_id, name, description, price, badge, featured, position) values
    (c_burgers, 'Slam Dunk', 'Triple steak smashé, triple cheddar, bacon de bœuf, oignons croustillants, sauce BBQ fumée', 79, 'XXL', true, 3) returning id into p_slam;
  insert into products (category_id, name, description, price, badge, featured, position) values
    (c_burgers, 'Buzzer Beater', 'Double steak smashé, cheddar, jalapeños, sauce piquante maison, oignons rouges', 65, 'Épicé 🌶️', false, 4) returning id into p_buzzer;
  insert into products (category_id, name, description, price, badge, featured, position) values
    (c_chicken, 'Alley-Oop', 'Poulet crispy, cheddar, salade, pickles, mayo épicée', 55, null, true, 1) returning id into p_alley;
  insert into products (category_id, name, description, price, badge, featured, position) values
    (c_chicken, 'Crossover', 'Poulet crispy + steak smashé, cheddar, sauce Dunk. Le meilleur des deux mondes', 72, 'Nouveau', false, 2) returning id into p_crossover;
  insert into products (category_id, name, description, price, position) values
    (c_sides, 'Frites maison', 'Frites fraîches double cuisson', 18, 1) returning id into p_fries;
  insert into products (category_id, name, description, price, position) values
    (c_sides, 'Cheese Fries', 'Frites nappées de cheddar fondu et oignons croustillants', 29, 2) returning id into p_cheesefries;
  insert into products (category_id, name, description, price, position) values
    (c_sides, 'Tenders x5', '5 tenders de poulet crispy', 39, 3) returning id into p_tenders;
  insert into products (category_id, name, description, price, position) values
    (c_sides, 'Onion Rings x8', 'Rondelles d''oignon panées', 24, 4) returning id into p_rings;
  insert into products (category_id, name, price, position) values (c_drinks, 'Coca-Cola 33cl', 12, 1) returning id into p_coca;
  insert into products (category_id, name, price, position) values (c_drinks, 'Fanta 33cl', 12, 2) returning id into p_fanta;
  insert into products (category_id, name, price, position) values (c_drinks, 'Sprite 33cl', 12, 3) returning id into p_sprite;
  insert into products (category_id, name, price, position) values (c_drinks, 'Eau minérale 50cl', 8, 4) returning id into p_water;
  insert into products (category_id, name, description, price, position) values
    (c_desserts, 'Cookie géant', 'Cookie moelleux aux pépites de chocolat', 18, 1) returning id into p_cookie;
  insert into products (category_id, name, description, price, position) values
    (c_desserts, 'Milkshake', 'Milkshake épais, chantilly', 32, 2) returning id into p_shake;

  -- Groupes d'options
  insert into option_groups (name, internal_name, min_select, max_select, position) values
    ('Nombre de steaks', 'Steaks Rookie/Buzzer', 1, 1, 1) returning id into g_steaks;
  insert into options (group_id, name, price, position) values
    (g_steaks, 'Simple', 0, 1), (g_steaks, 'Double', 15, 2), (g_steaks, 'Triple', 28, 3);

  insert into option_groups (name, internal_name, min_select, max_select, position) values
    ('Suppléments', 'Suppléments burgers', 0, 6, 2) returning id into g_extras;
  insert into options (group_id, name, price, position) values
    (g_extras, 'Cheddar', 5, 1), (g_extras, 'Steak smashé', 15, 2), (g_extras, 'Bacon de bœuf', 10, 3),
    (g_extras, 'Oignons caramélisés', 5, 4), (g_extras, 'Jalapeños', 5, 5), (g_extras, 'Œuf', 5, 6);

  insert into option_groups (name, internal_name, min_select, max_select, position) values
    ('Change ta sauce', 'Sauces burgers', 0, 2, 3) returning id into g_sauces;
  insert into options (group_id, name, price, position) values
    (g_sauces, 'Sauce Dunk', 0, 1), (g_sauces, 'BBQ fumée', 0, 2), (g_sauces, 'Mayo épicée', 0, 3),
    (g_sauces, 'Algérienne', 0, 4), (g_sauces, 'Ketchup', 0, 5);

  insert into option_groups (name, internal_name, min_select, max_select, position) values
    ('Retirer', 'Retirer ingrédients', 0, 4, 4) returning id into g_remove;
  insert into options (group_id, name, price, position) values
    (g_remove, 'Sans oignons', 0, 1), (g_remove, 'Sans cornichons', 0, 2), (g_remove, 'Sans sauce', 0, 3), (g_remove, 'Sans fromage', 0, 4);

  insert into option_groups (name, internal_name, min_select, max_select, position) values
    ('Fais-en un menu', 'Formule menu', 0, 1, 5) returning id into g_menu;
  insert into options (group_id, name, price, position) values
    (g_menu, 'Menu : frites + boisson', 25, 1), (g_menu, 'Menu XL : cheese fries + boisson', 38, 2);

  insert into option_groups (name, internal_name, min_select, max_select, position) values
    ('Boisson du menu', 'Boisson formule', 0, 1, 6) returning id into g_menu_drink;
  insert into options (group_id, name, price, position) values
    (g_menu_drink, 'Coca-Cola', 0, 1), (g_menu_drink, 'Coca-Cola Zéro', 0, 2), (g_menu_drink, 'Fanta', 0, 3),
    (g_menu_drink, 'Sprite', 0, 4), (g_menu_drink, 'Eau minérale', 0, 5);

  insert into option_groups (name, internal_name, min_select, max_select, position) values
    ('Sauce pour tes frites', 'Sauce frites', 0, 2, 7) returning id into g_fries_sauce;
  insert into options (group_id, name, price, position) values
    (g_fries_sauce, 'Ketchup', 0, 1), (g_fries_sauce, 'Mayo', 0, 2), (g_fries_sauce, 'Sauce Dunk', 3, 3), (g_fries_sauce, 'Cheddar fondu', 7, 4);

  insert into option_groups (name, internal_name, min_select, max_select, position) values
    ('Sauce tenders', 'Sauce tenders', 1, 2, 8) returning id into g_tenders_sauce;
  insert into options (group_id, name, price, position) values
    (g_tenders_sauce, 'BBQ fumée', 0, 1), (g_tenders_sauce, 'Honey mustard', 0, 2), (g_tenders_sauce, 'Mayo épicée', 0, 3);

  insert into option_groups (name, internal_name, min_select, max_select, position) values
    ('Parfum', 'Parfum milkshake', 1, 1, 9) returning id into g_shake;
  insert into options (group_id, name, price, position) values
    (g_shake, 'Vanille', 0, 1), (g_shake, 'Chocolat', 0, 2), (g_shake, 'Fraise', 0, 3), (g_shake, 'Oreo', 5, 4);

  -- Associations : chaque groupe n'est relié qu'aux produits concernés
  insert into product_option_groups (product_id, group_id, position) values
    (p_rookie, g_steaks, 1),
    (p_rookie, g_extras, 2), (p_dunk, g_extras, 2), (p_slam, g_extras, 2), (p_buzzer, g_extras, 2), (p_alley, g_extras, 2), (p_crossover, g_extras, 2),
    (p_rookie, g_sauces, 3), (p_dunk, g_sauces, 3), (p_slam, g_sauces, 3), (p_buzzer, g_sauces, 3), (p_alley, g_sauces, 3), (p_crossover, g_sauces, 3),
    (p_rookie, g_remove, 4), (p_dunk, g_remove, 4), (p_slam, g_remove, 4), (p_buzzer, g_remove, 4), (p_alley, g_remove, 4), (p_crossover, g_remove, 4),
    (p_rookie, g_menu, 5), (p_dunk, g_menu, 5), (p_slam, g_menu, 5), (p_buzzer, g_menu, 5), (p_alley, g_menu, 5), (p_crossover, g_menu, 5),
    (p_rookie, g_menu_drink, 6), (p_dunk, g_menu_drink, 6), (p_slam, g_menu_drink, 6), (p_buzzer, g_menu_drink, 6), (p_alley, g_menu_drink, 6), (p_crossover, g_menu_drink, 6),
    (p_fries, g_fries_sauce, 1), (p_cheesefries, g_fries_sauce, 1),
    (p_tenders, g_tenders_sauce, 1),
    (p_shake, g_shake, 1);

  -- Code promo de bienvenue
  insert into promo_codes (code, description, type, value, min_order, first_order_only, max_uses_per_customer)
  values ('DUNK15', '-15% sur la première commande', 'percent', 15, 60, true, 1);
end $$;
