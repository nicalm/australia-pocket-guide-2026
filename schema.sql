create table if not exists packing_items (
  id text primary key,
  category text not null check(length(category) between 1 and 60),
  label text not null check(length(label) between 1 and 160),
  packed integer not null default 0 check(packed in (0,1)),
  position real not null default 0,
  updated_at integer not null default (unixepoch())
);

create index if not exists packing_items_position_idx on packing_items(position, id);

create table if not exists shared_settings (
  key text primary key,
  value text not null default '',
  updated_at integer not null default (unixepoch())
);

create table if not exists todos (
  id text primary key,
  label text not null check(length(label) between 1 and 120),
  completed integer not null default 0 check(completed in (0,1)),
  position real not null default 0,
  updated_at integer not null default (unixepoch())
);

create index if not exists todos_position_idx on todos(position, id);
