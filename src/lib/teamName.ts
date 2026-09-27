/**
 * Alliterative team names.
 *
 * A name is built from the first letter of the player's first name, so Jaren
 * gets "Jaren's Jumping Jackrabbits". Every word is chosen to be family
 * friendly, and each letter carries enough adjectives and nouns that the same
 * pairing rarely comes round twice.
 */

const ADJECTIVES: Record<string, string[]> = {
  a: ['Absolute', 'Agile', 'Amazing', 'Ambitious', 'Ancient', 'Angry', 'Artful', 'Astonishing', 'Athletic', 'Audacious', 'Automatic', 'Avid', 'Awesome', 'Airborne'],
  b: ['Bold', 'Bouncing', 'Brave', 'Brilliant', 'Bruising', 'Bustling', 'Blazing', 'Blissful', 'Booming', 'Boundless', 'Breezy', 'Bright', 'Burly', 'Buzzing'],
  c: ['Clever', 'Colossal', 'Cosmic', 'Crafty', 'Crushing', 'Curious', 'Calm', 'Captivating', 'Charging', 'Cheerful', 'Chilly', 'Classic', 'Clutch', 'Courageous'],
  d: ['Daring', 'Dazzling', 'Determined', 'Devoted', 'Diligent', 'Dynamic', 'Dashing', 'Decisive', 'Deep', 'Defiant', 'Delightful', 'Dependable', 'Downhill', 'Dusty'],
  e: ['Eager', 'Earnest', 'Efficient', 'Electric', 'Elegant', 'Elite', 'Endless', 'Energetic', 'Enormous', 'Epic', 'Established', 'Eternal', 'Excellent', 'Exploding'],
  f: ['Fearless', 'Ferocious', 'Fierce', 'Fiery', 'Flying', 'Focused', 'Fabulous', 'Fantastic', 'Fast', 'Fearsome', 'Flawless', 'Frosty', 'Furious', 'Fumbling'],
  g: ['Galloping', 'Gigantic', 'Glorious', 'Golden', 'Graceful', 'Grand', 'Great', 'Gritty', 'Growling', 'Gallant', 'Generous', 'Gleaming', 'Gnarly', 'Gusty'],
  h: ['Happy', 'Hardy', 'Heroic', 'Honest', 'Howling', 'Humble', 'Hungry', 'Hustling', 'Handy', 'Harmonic', 'Heavy', 'Helpful', 'Hopeful', 'Hyper'],
  i: ['Icy', 'Ideal', 'Illustrious', 'Immense', 'Impressive', 'Incredible', 'Independent', 'Infinite', 'Ingenious', 'Inspired', 'Intense', 'Intrepid', 'Invincible', 'Iron'],
  j: ['Jazzy', 'Jolly', 'Joyful', 'Jubilant', 'Jumping', 'Just', 'Jagged', 'Jaunty', 'Jetting', 'Jovial', 'Judicious', 'Juggling', 'Jumbo', 'Jittery'],
  k: ['Keen', 'Kicking', 'Kind', 'Kingly', 'Knowing', 'Knightly', 'Kaleidoscopic', 'Kinetic', 'Killer', 'Kooky', 'Kindly', 'Knockout', 'Krafty', 'Kindred'],
  l: ['Legendary', 'Lightning', 'Lively', 'Loyal', 'Lucky', 'Luminous', 'Landmark', 'Large', 'Laughing', 'Leaping', 'Limitless', 'Lofty', 'Loud', 'Lumbering'],
  m: ['Magical', 'Majestic', 'Mighty', 'Marvelous', 'Masterful', 'Meteoric', 'Merry', 'Massive', 'Maverick', 'Mellow', 'Midnight', 'Modest', 'Monstrous', 'Motivated'],
  n: ['Nimble', 'Noble', 'Notorious', 'Natural', 'Nautical', 'Neat', 'Nervy', 'Never-ending', 'Nifty', 'Noisy', 'Northern', 'Nuclear', 'Numerous', 'Nocturnal'],
  o: ['Obvious', 'Odd', 'Official', 'Olympic', 'Optimal', 'Optimistic', 'Original', 'Outstanding', 'Overwhelming', 'Ornery', 'Onward', 'Opulent', 'Orbiting', 'Outbound'],
  p: ['Powerful', 'Precise', 'Proud', 'Playful', 'Perfect', 'Persistent', 'Phenomenal', 'Pioneering', 'Plucky', 'Polished', 'Pouncing', 'Prancing', 'Prime', 'Punishing'],
  q: ['Quick', 'Quiet', 'Quirky', 'Quality', 'Quaking', 'Quantum', 'Queenly', 'Quenching', 'Questing', 'Quizzical', 'Quintessential', 'Quotable', 'Quivering', 'Quaint'],
  r: ['Radiant', 'Rapid', 'Reliable', 'Relentless', 'Roaring', 'Rugged', 'Royal', 'Rambunctious', 'Rare', 'Ready', 'Rebellious', 'Resilient', 'Rocketing', 'Rowdy'],
  s: ['Speedy', 'Spirited', 'Steady', 'Stellar', 'Strong', 'Supreme', 'Savvy', 'Scrappy', 'Sensational', 'Sharp', 'Shining', 'Silent', 'Soaring', 'Sturdy'],
  t: ['Tenacious', 'Terrific', 'Thundering', 'Towering', 'Tremendous', 'Triumphant', 'Turbo', 'Tactical', 'Tall', 'Tireless', 'Tough', 'Tranquil', 'Trusty', 'Twisting'],
  u: ['Ultimate', 'Unbeatable', 'Unbreakable', 'Unstoppable', 'Upbeat', 'Useful', 'Unified', 'Unique', 'United', 'Universal', 'Untamed', 'Upward', 'Urgent', 'Uncanny'],
  v: ['Valiant', 'Vibrant', 'Victorious', 'Vigilant', 'Vivid', 'Voracious', 'Vast', 'Velvet', 'Venturesome', 'Verified', 'Veteran', 'Vigorous', 'Visionary', 'Volcanic'],
  w: ['Wandering', 'Watchful', 'Wild', 'Winning', 'Wise', 'Wondrous', 'Whirling', 'Wily', 'Windy', 'Wicked-fast', 'Willing', 'Winged', 'Worthy', 'Wobbly'],
  x: ['Xtra-Bold', 'Xtreme', 'Xemplary', 'Xpert', 'Xpress', 'Xcellent', 'Xciting', 'Xuberant', 'Xalted', 'Xpanding', 'Xploring', 'Xponential', 'Xactly-Right', 'Xhilarating'],
  y: ['Yearning', 'Yelling', 'Young', 'Youthful', 'Yawning', 'Yonder', 'Yielding', 'Yummy', 'Yodeling', 'Yare', 'Yeasty', 'Yielding', 'Yankee', 'Yowling'],
  z: ['Zany', 'Zealous', 'Zesty', 'Zigzagging', 'Zippy', 'Zooming', 'Zenith', 'Zealful', 'Zigzag', 'Zonked', 'Zippity', 'Zestful', 'Zodiac', 'Zonal'],
};

const NOUNS: Record<string, string[]> = {
  a: ['Aardvarks', 'Admirals', 'Alligators', 'Anchors', 'Antelope', 'Apes', 'Archers', 'Armadillos', 'Arrows', 'Astronauts', 'Avalanche', 'Aviators', 'Acorns', 'Albatross'],
  b: ['Badgers', 'Bandits', 'Barracudas', 'Bears', 'Beavers', 'Bison', 'Blizzards', 'Bobcats', 'Boulders', 'Bulldogs', 'Bulls', 'Buffalo', 'Bumblebees', 'Buccaneers'],
  c: ['Cannons', 'Captains', 'Cardinals', 'Cheetahs', 'Chargers', 'Cobras', 'Comets', 'Condors', 'Cougars', 'Coyotes', 'Crusaders', 'Cyclones', 'Crickets', 'Chipmunks'],
  d: ['Dalmatians', 'Defenders', 'Dolphins', 'Dragons', 'Drifters', 'Ducks', 'Dukes', 'Dynamos', 'Daredevils', 'Deacons', 'Diamondbacks', 'Diggers', 'Dingoes', 'Donkeys'],
  e: ['Eagles', 'Earthquakes', 'Eels', 'Elephants', 'Elk', 'Emeralds', 'Emperors', 'Engineers', 'Explorers', 'Express', 'Enforcers', 'Escapades', 'Everglades', 'Echoes'],
  f: ['Falcons', 'Ferrets', 'Fighters', 'Finches', 'Firebirds', 'Flamingos', 'Flyers', 'Foxes', 'Friars', 'Frogs', 'Furies', 'Flounders', 'Ferns', 'Fireflies'],
  g: ['Gators', 'Generals', 'Giants', 'Gladiators', 'Goats', 'Golden Bears', 'Gophers', 'Gorillas', 'Grizzlies', 'Guardians', 'Gulls', 'Gazelles', 'Geckos', 'Geese'],
  h: ['Hawks', 'Hammers', 'Hares', 'Harriers', 'Hedgehogs', 'Herons', 'Hornets', 'Horsemen', 'Hounds', 'Huskies', 'Hurricanes', 'Hippos', 'Hummingbirds', 'Highlanders'],
  i: ['Ibex', 'Icebergs', 'Iguanas', 'Impalas', 'Inventors', 'Invaders', 'Islanders', 'Ironmen', 'Infernos', 'Impacts', 'Instincts', 'Ibises', 'Icicles', 'Imps'],
  j: ['Jackrabbits', 'Jaguars', 'Jays', 'Jets', 'Jokers', 'Journeymen', 'Judges', 'Juggernauts', 'Jumpers', 'Junipers', 'Jackals', 'Jellyfish', 'Jesters', 'Javelins'],
  k: ['Kangaroos', 'Kestrels', 'Keys', 'Kingfishers', 'Kings', 'Kites', 'Knights', 'Koalas', 'Kodiaks', 'Komodos', 'Krakens', 'Kittens', 'Kernels', 'Keepers'],
  l: ['Lancers', 'Leopards', 'Lightning', 'Lions', 'Llamas', 'Lobsters', 'Locomotives', 'Longhorns', 'Lynx', 'Lumberjacks', 'Larks', 'Ladybugs', 'Lemurs', 'Legends'],
  m: ['Mammoths', 'Manatees', 'Mariners', 'Marlins', 'Mavericks', 'Meteors', 'Mustangs', 'Monarchs', 'Mongooses', 'Moose', 'Mountaineers', 'Mules', 'Magpies', 'Minutemen'],
  n: ['Narwhals', 'Natives', 'Navigators', 'Nighthawks', 'Nomads', 'Norsemen', 'Nuggets', 'Newts', 'Nightingales', 'Ninjas', 'Nectarines', 'Nebulas', 'Nutcrackers', 'Nightjars'],
  o: ['Oaks', 'Ocelots', 'Octopi', 'Orcas', 'Orioles', 'Ospreys', 'Otters', 'Outlaws', 'Owls', 'Oxen', 'Olympians', 'Observers', 'Oysters', 'Opals'],
  p: ['Panthers', 'Patriots', 'Pelicans', 'Penguins', 'Phoenixes', 'Pilots', 'Pioneers', 'Pirates', 'Porcupines', 'Prairie Dogs', 'Pumas', 'Pythons', 'Pandas', 'Parrots'],
  q: ['Quails', 'Quakers', 'Quarterbacks', 'Queens', 'Quests', 'Quills', 'Quicksilver', 'Quokkas', 'Quasars', 'Quartets', 'Quarries', 'Quivers', 'Quetzals', 'Quintets'],
  r: ['Rams', 'Rangers', 'Raptors', 'Ravens', 'Rebels', 'Redwoods', 'Reindeer', 'Rhinos', 'Riverhounds', 'Roadrunners', 'Rockets', 'Rovers', 'Raccoons', 'Robins'],
  s: ['Sabers', 'Salmon', 'Scorpions', 'Seahawks', 'Sentinels', 'Sharks', 'Snappers', 'Sparrows', 'Stallions', 'Stars', 'Storm', 'Sunfish', 'Squirrels', 'Starlings'],
  t: ['Tacklers', 'Tigers', 'Timberwolves', 'Titans', 'Toucans', 'Tornadoes', 'Torpedoes', 'Trailblazers', 'Travelers', 'Tridents', 'Trojans', 'Turtles', 'Tadpoles', 'Thunderbirds'],
  u: ['Unicorns', 'Utes', 'Umpires', 'Underdogs', 'Uprisings', 'Urchins', 'Ultras', 'Updrafts', 'Uplanders', 'Upstarts', 'Utopians', 'Ushers', 'Ukuleles', 'Umbrellas'],
  v: ['Vikings', 'Vipers', 'Voyagers', 'Vultures', 'Volunteers', 'Valkyries', 'Vaqueros', 'Velociraptors', 'Vanguards', 'Vandals', 'Violets', 'Vessels', 'Vortexes', 'Voles'],
  w: ['Walruses', 'Warriors', 'Wasps', 'Whales', 'Wildcats', 'Wolverines', 'Wolves', 'Wombats', 'Woodpeckers', 'Wranglers', 'Wizards', 'Warblers', 'Waves', 'Wildfires'],
  x: ['Xenops', 'Xerus', 'X-Rays', 'Xylophones', 'Xenoliths', 'Xiphias', 'Xebecs', 'Xenias', 'Xerics', 'Xystus', 'Xenon', 'Xanthids', 'Xeriscapes', 'Xenopus'],
  y: ['Yaks', 'Yellowjackets', 'Yetis', 'Yeomen', 'Yearlings', 'Yachts', 'Yardbirds', 'Yodelers', 'Yeasts', 'Yuccas', 'Yews', 'Yawls', 'Yellowtails', 'Yesterdays'],
  z: ['Zebras', 'Zeppelins', 'Zephyrs', 'Zigzags', 'Zealots', 'Zorillas', 'Zebus', 'Zithers', 'Zodiacs', 'Zoomers', 'Zinnias', 'Zappers', 'Zenith', 'Zebrafish'],
};

const FALLBACK_LETTER = 's';

function listFor(table: Record<string, string[]>, letter: string): string[] {
  return table[letter] ?? table[FALLBACK_LETTER];
}

function firstLetter(name: string): string {
  const match = name.trim().toLowerCase().match(/[a-z]/);
  return match ? match[0] : FALLBACK_LETTER;
}

function possessive(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return 'Your';
  return /s$/i.test(trimmed) ? `${trimmed}'` : `${trimmed}'s`;
}

function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

/**
 * "Jaren's Jumping Jackrabbits". The adjective and noun alliterate with the
 * first name; a name starting with a letter we have no list for borrows one.
 */
export function generateTeamName(firstName: string): string {
  const letter = firstLetter(firstName);
  const adjective = pick(listFor(ADJECTIVES, letter));
  const noun = pick(listFor(NOUNS, letter));
  return `${possessive(firstName || 'Your')} ${adjective} ${noun}`;
}

/** How many distinct names a given first name can produce. */
export function teamNameVariations(firstName: string): number {
  const letter = firstLetter(firstName);
  return listFor(ADJECTIVES, letter).length * listFor(NOUNS, letter).length;
}
