import type { CountryRegion } from "../../../db/models/referenceDb.models";

/**
 * Administrative regions and their cities per ISO 3166-1 alpha-2 country —
 * OD `COUNTRY_REGIONS` merged with `COUNTRY_REGIONS_REST` (js/core.js).
 *
 * OD keeps the two apart only to load the detailed set first: it copies REST
 * across for any country the main table does not already define
 * (`Object.keys(COUNTRY_REGIONS_REST).forEach(k => { if (!COUNTRY_REGIONS[k]) ... })`),
 * so the main table's richer entry always wins. That merge is already applied
 * here — 245 countries, 690 regions, 1346 cities.
 *
 * The `countries.regions` column and the `CountryRegion` type already existed;
 * only the data was missing, so every country came back with an empty region
 * list and the region/city pickers had nothing to offer.
 */
export const COUNTRY_REGION_SEED: Record<string, CountryRegion[]> = {
  AD: [
    { name: "Andorra la Vella", cities: ["Andorra la Vella"] },
    { name: "Escaldes-Engordany", cities: ["Escaldes-Engordany"] },
  ],
  AE: [
    { name: "Dubai", cities: ["Dubai"] },
    { name: "Abu Dhabi", cities: ["Abu Dhabi", "Al Ain"] },
    { name: "Sharjah", cities: ["Sharjah"] },
  ],
  AF: [
    { name: "Kabul", cities: ["Kabul"] },
    { name: "Kandahar", cities: ["Kandahar"] },
    { name: "Herat", cities: ["Herat"] },
    { name: "Balkh", cities: ["Mazar-i-Sharif"] },
  ],
  AG: [
    { name: "Antigua", cities: ["St. John's"] },
    { name: "Barbuda", cities: ["Codrington"] },
  ],
  AI: [
    { name: "Anguilla", cities: ["The Valley"] },
  ],
  AL: [
    { name: "Tirana", cities: ["Tirana", "Kamëz"] },
    { name: "Durrës", cities: ["Durrës"] },
    { name: "Vlorë", cities: ["Vlorë"] },
    { name: "Shkodër", cities: ["Shkodër"] },
  ],
  AM: [
    { name: "Yerevan", cities: ["Yerevan"] },
    { name: "Shirak", cities: ["Gyumri"] },
    { name: "Lori", cities: ["Vanadzor"] },
  ],
  AO: [
    { name: "Luanda", cities: ["Luanda"] },
    { name: "Huambo", cities: ["Huambo"] },
    { name: "Benguela", cities: ["Benguela", "Lobito"] },
  ],
  AR: [
    { name: "Buenos Aires (City)", cities: ["Buenos Aires"] },
    { name: "Buenos Aires Province", cities: ["La Plata", "Mar del Plata"] },
    { name: "Córdoba", cities: ["Córdoba"] },
    { name: "Santa Fe", cities: ["Rosario"] },
    { name: "Mendoza", cities: ["Mendoza"] },
  ],
  AS: [
    { name: "Tutuila", cities: ["Pago Pago"] },
  ],
  AT: [
    { name: "Vienna", cities: ["Vienna"] },
    { name: "Styria", cities: ["Graz"] },
    { name: "Upper Austria", cities: ["Linz"] },
    { name: "Salzburg", cities: ["Salzburg"] },
    { name: "Tyrol", cities: ["Innsbruck"] },
  ],
  AU: [
    { name: "New South Wales", cities: ["Sydney", "Newcastle", "Wollongong"] },
    { name: "Victoria", cities: ["Melbourne", "Geelong"] },
    { name: "Queensland", cities: ["Brisbane", "Gold Coast", "Cairns", "Townsville"] },
    { name: "Western Australia", cities: ["Perth", "Fremantle"] },
    { name: "South Australia", cities: ["Adelaide"] },
    { name: "Tasmania", cities: ["Hobart", "Launceston"] },
    { name: "Australian Capital Territory", cities: ["Canberra"] },
    { name: "Northern Territory", cities: ["Darwin"] },
  ],
  AW: [
    { name: "Aruba", cities: ["Oranjestad", "San Nicolaas"] },
  ],
  AX: [
    { name: "Åland", cities: ["Mariehamn"] },
  ],
  AZ: [
    { name: "Baku", cities: ["Baku"] },
    { name: "Ganja", cities: ["Ganja"] },
    { name: "Sumqayit", cities: ["Sumqayit"] },
  ],
  BA: [
    { name: "Sarajevo", cities: ["Sarajevo"] },
    { name: "Republika Srpska", cities: ["Banja Luka"] },
    { name: "Herzegovina-Neretva", cities: ["Mostar"] },
    { name: "Tuzla", cities: ["Tuzla"] },
  ],
  BB: [
    { name: "Saint Michael", cities: ["Bridgetown"] },
  ],
  BD: [
    { name: "Dhaka", cities: ["Dhaka", "Narayanganj"] },
    { name: "Chittagong", cities: ["Chittagong"] },
    { name: "Khulna", cities: ["Khulna"] },
    { name: "Rajshahi", cities: ["Rajshahi"] },
    { name: "Sylhet", cities: ["Sylhet"] },
  ],
  BE: [
    { name: "Brussels", cities: ["Brussels"] },
    { name: "Antwerp", cities: ["Antwerp"] },
    { name: "East Flanders", cities: ["Ghent"] },
    { name: "West Flanders", cities: ["Bruges"] },
    { name: "Liège", cities: ["Liège"] },
  ],
  BF: [
    { name: "Centre", cities: ["Ouagadougou"] },
    { name: "Hauts-Bassins", cities: ["Bobo-Dioulasso"] },
  ],
  BG: [
    { name: "Sofia", cities: ["Sofia"] },
    { name: "Plovdiv", cities: ["Plovdiv"] },
    { name: "Varna", cities: ["Varna"] },
    { name: "Burgas", cities: ["Burgas"] },
  ],
  BH: [
    { name: "Capital", cities: ["Manama"] },
    { name: "Northern", cities: ["Riffa"] },
    { name: "Muharraq", cities: ["Muharraq"] },
  ],
  BI: [
    { name: "Gitega", cities: ["Gitega"] },
    { name: "Bujumbura", cities: ["Bujumbura"] },
  ],
  BJ: [
    { name: "Ouémé", cities: ["Porto-Novo"] },
    { name: "Littoral", cities: ["Cotonou"] },
  ],
  BL: [
    { name: "Saint Barthélemy", cities: ["Gustavia"] },
  ],
  BM: [
    { name: "Pembroke", cities: ["Hamilton"] },
    { name: "Saint George's", cities: ["St. George's"] },
  ],
  BN: [
    { name: "Brunei-Muara", cities: ["Bandar Seri Begawan"] },
    { name: "Belait", cities: ["Kuala Belait"] },
  ],
  BO: [
    { name: "La Paz", cities: ["La Paz", "El Alto"] },
    { name: "Santa Cruz", cities: ["Santa Cruz de la Sierra"] },
    { name: "Cochabamba", cities: ["Cochabamba"] },
    { name: "Chuquisaca", cities: ["Sucre"] },
  ],
  BQ: [
    { name: "Bonaire", cities: ["Kralendijk"] },
  ],
  BR: [
    { name: "São Paulo", cities: ["São Paulo", "Campinas", "Guarulhos"] },
    { name: "Rio de Janeiro", cities: ["Rio de Janeiro", "Niterói"] },
    { name: "Minas Gerais", cities: ["Belo Horizonte"] },
    { name: "Bahia", cities: ["Salvador"] },
    { name: "Paraná", cities: ["Curitiba"] },
    { name: "Distrito Federal", cities: ["Brasília"] },
  ],
  BS: [
    { name: "New Providence", cities: ["Nassau"] },
    { name: "Grand Bahama", cities: ["Freeport"] },
  ],
  BT: [
    { name: "Thimphu", cities: ["Thimphu"] },
    { name: "Chukha", cities: ["Phuntsholing"] },
  ],
  BW: [
    { name: "South-East", cities: ["Gaborone"] },
    { name: "North-East", cities: ["Francistown"] },
  ],
  BY: [
    { name: "Minsk", cities: ["Minsk"] },
    { name: "Gomel", cities: ["Gomel"] },
    { name: "Mogilev", cities: ["Mogilev"] },
    { name: "Vitebsk", cities: ["Vitebsk"] },
    { name: "Brest", cities: ["Brest"] },
  ],
  BZ: [
    { name: "Cayo", cities: ["Belmopan"] },
    { name: "Belize", cities: ["Belize City"] },
  ],
  CA: [
    { name: "Ontario", cities: ["Toronto", "Ottawa", "Mississauga", "Hamilton"] },
    { name: "Quebec", cities: ["Montreal", "Quebec City", "Laval"] },
    { name: "British Columbia", cities: ["Vancouver", "Victoria", "Surrey"] },
    { name: "Alberta", cities: ["Calgary", "Edmonton"] },
    { name: "Manitoba", cities: ["Winnipeg"] },
    { name: "Nova Scotia", cities: ["Halifax"] },
  ],
  CC: [
    { name: "Cocos Islands", cities: ["West Island"] },
  ],
  CD: [
    { name: "Kinshasa", cities: ["Kinshasa"] },
    { name: "Haut-Katanga", cities: ["Lubumbashi"] },
    { name: "Kasaï-Oriental", cities: ["Mbuji-Mayi"] },
    { name: "North Kivu", cities: ["Goma"] },
  ],
  CF: [
    { name: "Bangui", cities: ["Bangui"] },
  ],
  CG: [
    { name: "Brazzaville", cities: ["Brazzaville"] },
    { name: "Pointe-Noire", cities: ["Pointe-Noire"] },
  ],
  CH: [
    { name: "Bern", cities: ["Bern"] },
    { name: "Zürich", cities: ["Zurich"] },
    { name: "Geneva", cities: ["Geneva"] },
    { name: "Basel-City", cities: ["Basel"] },
    { name: "Vaud", cities: ["Lausanne"] },
  ],
  CI: [
    { name: "Lacs", cities: ["Yamoussoukro"] },
    { name: "Abidjan", cities: ["Abidjan"] },
  ],
  CK: [
    { name: "Rarotonga", cities: ["Avarua"] },
  ],
  CL: [
    { name: "Santiago Metropolitan", cities: ["Santiago", "Puente Alto", "Maipú"] },
    { name: "Valparaíso", cities: ["Valparaíso", "Viña del Mar"] },
    { name: "Biobío", cities: ["Concepción"] },
    { name: "Antofagasta", cities: ["Antofagasta"] },
    { name: "Coquimbo", cities: ["La Serena"] },
  ],
  CM: [
    { name: "Centre", cities: ["Yaoundé"] },
    { name: "Littoral", cities: ["Douala"] },
    { name: "North-West", cities: ["Bamenda"] },
  ],
  CN: [
    { name: "Beijing", cities: ["Beijing"] },
    { name: "Shanghai", cities: ["Shanghai"] },
    { name: "Guangdong", cities: ["Guangzhou", "Shenzhen", "Dongguan", "Foshan"] },
    { name: "Zhejiang", cities: ["Hangzhou", "Ningbo", "Wenzhou"] },
    { name: "Jiangsu", cities: ["Nanjing", "Suzhou", "Wuxi"] },
    { name: "Sichuan", cities: ["Chengdu"] },
    { name: "Hubei", cities: ["Wuhan"] },
    { name: "Shaanxi", cities: ["Xi'an"] },
    { name: "Chongqing", cities: ["Chongqing"] },
    { name: "Shandong", cities: ["Qingdao", "Jinan"] },
  ],
  CO: [
    { name: "Bogotá", cities: ["Bogotá"] },
    { name: "Antioquia", cities: ["Medellín"] },
    { name: "Valle del Cauca", cities: ["Cali"] },
    { name: "Atlántico", cities: ["Barranquilla"] },
    { name: "Bolívar", cities: ["Cartagena"] },
  ],
  CR: [
    { name: "San José", cities: ["San José"] },
    { name: "Alajuela", cities: ["Alajuela"] },
    { name: "Cartago", cities: ["Cartago"] },
  ],
  CU: [
    { name: "Havana", cities: ["Havana"] },
    { name: "Santiago de Cuba", cities: ["Santiago de Cuba"] },
    { name: "Camagüey", cities: ["Camagüey"] },
  ],
  CV: [
    { name: "Santiago", cities: ["Praia"] },
    { name: "São Vicente", cities: ["Mindelo"] },
  ],
  CW: [
    { name: "Curaçao", cities: ["Willemstad"] },
  ],
  CX: [
    { name: "Christmas Island", cities: ["Flying Fish Cove"] },
  ],
  CY: [
    { name: "Nicosia", cities: ["Nicosia"] },
    { name: "Limassol", cities: ["Limassol"] },
    { name: "Larnaca", cities: ["Larnaca"] },
  ],
  CZ: [
    { name: "Prague", cities: ["Prague"] },
    { name: "South Moravian", cities: ["Brno"] },
    { name: "Moravian-Silesian", cities: ["Ostrava"] },
    { name: "Plzeň", cities: ["Plzeň"] },
  ],
  DE: [
    { name: "Berlin", cities: ["Berlin"] },
    { name: "Bavaria", cities: ["Munich", "Nuremberg", "Augsburg"] },
    { name: "Hamburg", cities: ["Hamburg"] },
    { name: "North Rhine-Westphalia", cities: ["Cologne", "Düsseldorf", "Dortmund", "Essen"] },
    { name: "Hesse", cities: ["Frankfurt", "Wiesbaden"] },
    { name: "Baden-Württemberg", cities: ["Stuttgart", "Mannheim", "Karlsruhe"] },
    { name: "Saxony", cities: ["Dresden", "Leipzig"] },
    { name: "Lower Saxony", cities: ["Hanover", "Braunschweig"] },
  ],
  DJ: [
    { name: "Djibouti", cities: ["Djibouti"] },
  ],
  DK: [
    { name: "Capital Region", cities: ["Copenhagen"] },
    { name: "Central Denmark", cities: ["Aarhus"] },
    { name: "Southern Denmark", cities: ["Odense"] },
    { name: "North Denmark", cities: ["Aalborg"] },
  ],
  DM: [
    { name: "Saint George", cities: ["Roseau"] },
  ],
  DO: [
    { name: "Distrito Nacional", cities: ["Santo Domingo"] },
    { name: "Santiago", cities: ["Santiago de los Caballeros"] },
  ],
  DZ: [
    { name: "Algiers", cities: ["Algiers"] },
    { name: "Oran", cities: ["Oran"] },
    { name: "Constantine", cities: ["Constantine"] },
    { name: "Annaba", cities: ["Annaba"] },
  ],
  EC: [
    { name: "Pichincha", cities: ["Quito"] },
    { name: "Guayas", cities: ["Guayaquil"] },
    { name: "Azuay", cities: ["Cuenca"] },
  ],
  EE: [
    { name: "Harju", cities: ["Tallinn"] },
    { name: "Tartu", cities: ["Tartu"] },
    { name: "Ida-Viru", cities: ["Narva"] },
  ],
  EG: [
    { name: "Cairo", cities: ["Cairo"] },
    { name: "Alexandria", cities: ["Alexandria"] },
    { name: "Giza", cities: ["Giza"] },
    { name: "Luxor", cities: ["Luxor"] },
    { name: "Aswan", cities: ["Aswan"] },
  ],
  EH: [
    { name: "Laâyoune", cities: ["Laayoune"] },
  ],
  ER: [
    { name: "Maekel", cities: ["Asmara"] },
    { name: "Northern Red Sea", cities: ["Massawa"] },
  ],
  ES: [
    { name: "Community of Madrid", cities: ["Madrid"] },
    { name: "Catalonia", cities: ["Barcelona", "Girona"] },
    { name: "Andalusia", cities: ["Seville", "Málaga", "Granada"] },
    { name: "Valencian Community", cities: ["Valencia", "Alicante"] },
    { name: "Basque Country", cities: ["Bilbao", "San Sebastián"] },
  ],
  ET: [
    { name: "Addis Ababa", cities: ["Addis Ababa"] },
    { name: "Dire Dawa", cities: ["Dire Dawa"] },
    { name: "Tigray", cities: ["Mekelle"] },
  ],
  FI: [
    { name: "Uusimaa", cities: ["Helsinki", "Espoo", "Vantaa"] },
    { name: "Pirkanmaa", cities: ["Tampere"] },
    { name: "Southwest Finland", cities: ["Turku"] },
    { name: "North Ostrobothnia", cities: ["Oulu"] },
  ],
  FJ: [
    { name: "Central", cities: ["Suva"] },
    { name: "Western", cities: ["Nadi", "Lautoka"] },
  ],
  FK: [
    { name: "East Falkland", cities: ["Stanley"] },
  ],
  FM: [
    { name: "Pohnpei", cities: ["Palikir"] },
  ],
  FO: [
    { name: "Streymoy", cities: ["Tórshavn"] },
  ],
  FR: [
    { name: "Île-de-France", cities: ["Paris", "Versailles", "Boulogne-Billancourt"] },
    { name: "Provence-Alpes-Côte d’Azur", cities: ["Marseille", "Nice", "Toulon"] },
    { name: "Auvergne-Rhône-Alpes", cities: ["Lyon", "Grenoble", "Saint-Étienne"] },
    { name: "Occitanie", cities: ["Toulouse", "Montpellier"] },
    { name: "Nouvelle-Aquitaine", cities: ["Bordeaux"] },
    { name: "Hauts-de-France", cities: ["Lille"] },
    { name: "Grand Est", cities: ["Strasbourg", "Reims"] },
    { name: "Pays de la Loire", cities: ["Nantes"] },
  ],
  GA: [
    { name: "Estuaire", cities: ["Libreville"] },
    { name: "Ogooué-Maritime", cities: ["Port-Gentil"] },
  ],
  GB: [
    { name: "England", cities: ["London", "Manchester", "Birmingham", "Liverpool", "Leeds", "Bristol", "Sheffield", "Newcastle"] },
    { name: "Scotland", cities: ["Edinburgh", "Glasgow", "Aberdeen", "Dundee"] },
    { name: "Wales", cities: ["Cardiff", "Swansea", "Newport"] },
    { name: "Northern Ireland", cities: ["Belfast", "Londonderry"] },
  ],
  GD: [
    { name: "Saint George", cities: ["St. George's"] },
  ],
  GE: [
    { name: "Tbilisi", cities: ["Tbilisi"] },
    { name: "Adjara", cities: ["Batumi"] },
    { name: "Imereti", cities: ["Kutaisi"] },
  ],
  GF: [
    { name: "Guiana", cities: ["Cayenne"] },
  ],
  GG: [
    { name: "Guernsey", cities: ["St. Peter Port"] },
  ],
  GH: [
    { name: "Greater Accra", cities: ["Accra"] },
    { name: "Ashanti", cities: ["Kumasi"] },
    { name: "Northern", cities: ["Tamale"] },
  ],
  GI: [
    { name: "Gibraltar", cities: ["Gibraltar"] },
  ],
  GL: [
    { name: "Sermersooq", cities: ["Nuuk"] },
  ],
  GM: [
    { name: "Banjul", cities: ["Banjul"] },
    { name: "Kanifing", cities: ["Serekunda"] },
  ],
  GN: [
    { name: "Conakry", cities: ["Conakry"] },
    { name: "Nzérékoré", cities: ["Nzérékoré"] },
  ],
  GP: [
    { name: "Guadeloupe", cities: ["Basse-Terre", "Pointe-à-Pitre"] },
  ],
  GQ: [
    { name: "Bioko Norte", cities: ["Malabo"] },
    { name: "Litoral", cities: ["Bata"] },
  ],
  GR: [
    { name: "Attica", cities: ["Athens", "Piraeus"] },
    { name: "Central Macedonia", cities: ["Thessaloniki"] },
    { name: "Western Greece", cities: ["Patras"] },
    { name: "Crete", cities: ["Heraklion"] },
  ],
  GT: [
    { name: "Guatemala", cities: ["Guatemala City"] },
    { name: "Quetzaltenango", cities: ["Quetzaltenango"] },
  ],
  GU: [
    { name: "Guam", cities: ["Hagåtña", "Dededo"] },
  ],
  GW: [
    { name: "Bissau", cities: ["Bissau"] },
  ],
  GY: [
    { name: "Demerara-Mahaica", cities: ["Georgetown"] },
  ],
  HK: [
    { name: "Hong Kong Island", cities: ["Central"] },
    { name: "Kowloon", cities: ["Kowloon"] },
    { name: "New Territories", cities: ["Sha Tin", "Tsuen Wan"] },
  ],
  HN: [
    { name: "Francisco Morazán", cities: ["Tegucigalpa"] },
    { name: "Cortés", cities: ["San Pedro Sula"] },
  ],
  HR: [
    { name: "Zagreb", cities: ["Zagreb"] },
    { name: "Split-Dalmatia", cities: ["Split"] },
    { name: "Primorje-Gorski Kotar", cities: ["Rijeka"] },
    { name: "Osijek-Baranja", cities: ["Osijek"] },
  ],
  HT: [
    { name: "Ouest", cities: ["Port-au-Prince"] },
    { name: "Nord", cities: ["Cap-Haïtien"] },
  ],
  HU: [
    { name: "Budapest", cities: ["Budapest"] },
    { name: "Hajdú-Bihar", cities: ["Debrecen"] },
    { name: "Csongrád-Csanád", cities: ["Szeged"] },
  ],
  ID: [
    { name: "Aceh", cities: ["Kota Banda Aceh", "Kota Langsa", "Kota Lhokseumawe", "Kota Sabang", "Kota Subulussalam", "Kabupaten Aceh Barat", "Kabupaten Aceh Barat Daya", "Kabupaten Aceh Besar", "Kabupaten Aceh Jaya", "Kabupaten Aceh Selatan", "Kabupaten Aceh Singkil", "Kabupaten Aceh Tamiang", "Kabupaten Aceh Tengah", "Kabupaten Aceh Tenggara", "Kabupaten Aceh Timur", "Kabupaten Aceh Utara", "Kabupaten Bener Meriah", "Kabupaten Bireuen", "Kabupaten Gayo Lues", "Kabupaten Nagan Raya", "Kabupaten Pidie", "Kabupaten Pidie Jaya", "Kabupaten Simeulue"] },
    { name: "Sumatera Utara", cities: ["Kota Medan", "Kota Binjai", "Kota Gunungsitoli", "Kota Padangsidimpuan", "Kota Pematangsiantar", "Kota Sibolga", "Kota Tanjungbalai", "Kota Tebing Tinggi", "Kabupaten Asahan", "Kabupaten Batu Bara", "Kabupaten Dairi", "Kabupaten Deli Serdang", "Kabupaten Humbang Hasundutan", "Kabupaten Karo", "Kabupaten Labuhanbatu", "Kabupaten Labuhanbatu Selatan", "Kabupaten Labuhanbatu Utara", "Kabupaten Langkat", "Kabupaten Mandailing Natal", "Kabupaten Nias", "Kabupaten Nias Barat", "Kabupaten Nias Selatan", "Kabupaten Nias Utara", "Kabupaten Padang Lawas", "Kabupaten Padang Lawas Utara", "Kabupaten Pakpak Bharat", "Kabupaten Samosir", "Kabupaten Serdang Bedagai", "Kabupaten Simalungun", "Kabupaten Tapanuli Selatan", "Kabupaten Tapanuli Tengah", "Kabupaten Tapanuli Utara", "Kabupaten Toba"] },
    { name: "Sumatera Barat", cities: ["Kota Padang", "Kota Bukittinggi", "Kota Padang Panjang", "Kota Pariaman", "Kota Payakumbuh", "Kota Sawahlunto", "Kota Solok", "Kabupaten Agam", "Kabupaten Dharmasraya", "Kabupaten Kepulauan Mentawai", "Kabupaten Lima Puluh Kota", "Kabupaten Padang Pariaman", "Kabupaten Pasaman", "Kabupaten Pasaman Barat", "Kabupaten Pesisir Selatan", "Kabupaten Sijunjung", "Kabupaten Solok", "Kabupaten Solok Selatan", "Kabupaten Tanah Datar"] },
    { name: "Riau", cities: ["Kota Pekanbaru", "Kota Dumai", "Kabupaten Bengkalis", "Kabupaten Indragiri Hilir", "Kabupaten Indragiri Hulu", "Kabupaten Kampar", "Kabupaten Kepulauan Meranti", "Kabupaten Kuantan Singingi", "Kabupaten Pelalawan", "Kabupaten Rokan Hilir", "Kabupaten Rokan Hulu", "Kabupaten Siak"] },
    { name: "Jambi", cities: ["Kota Jambi", "Kota Sungai Penuh", "Kabupaten Batanghari", "Kabupaten Bungo", "Kabupaten Kerinci", "Kabupaten Merangin", "Kabupaten Muaro Jambi", "Kabupaten Sarolangun", "Kabupaten Tanjung Jabung Barat", "Kabupaten Tanjung Jabung Timur", "Kabupaten Tebo"] },
    { name: "Sumatera Selatan", cities: ["Kota Palembang", "Kota Lubuklinggau", "Kota Pagar Alam", "Kota Prabumulih", "Kabupaten Banyuasin", "Kabupaten Empat Lawang", "Kabupaten Lahat", "Kabupaten Muara Enim", "Kabupaten Musi Banyuasin", "Kabupaten Musi Rawas", "Kabupaten Musi Rawas Utara", "Kabupaten Ogan Ilir", "Kabupaten Ogan Komering Ilir", "Kabupaten Ogan Komering Ulu", "Kabupaten Ogan Komering Ulu Selatan", "Kabupaten Ogan Komering Ulu Timur", "Kabupaten Penukal Abab Lematang Ilir"] },
    { name: "Bengkulu", cities: ["Kota Bengkulu", "Kabupaten Bengkulu Selatan", "Kabupaten Bengkulu Tengah", "Kabupaten Bengkulu Utara", "Kabupaten Kaur", "Kabupaten Kepahiang", "Kabupaten Lebong", "Kabupaten Mukomuko", "Kabupaten Rejang Lebong", "Kabupaten Seluma"] },
    { name: "Lampung", cities: ["Kota Bandar Lampung", "Kota Metro", "Kabupaten Lampung Barat", "Kabupaten Lampung Selatan", "Kabupaten Lampung Tengah", "Kabupaten Lampung Timur", "Kabupaten Lampung Utara", "Kabupaten Mesuji", "Kabupaten Pesawaran", "Kabupaten Pesisir Barat", "Kabupaten Pringsewu", "Kabupaten Tanggamus", "Kabupaten Tulang Bawang", "Kabupaten Tulang Bawang Barat", "Kabupaten Way Kanan"] },
    { name: "Kepulauan Bangka Belitung", cities: ["Kota Pangkalpinang", "Kabupaten Bangka", "Kabupaten Bangka Barat", "Kabupaten Bangka Selatan", "Kabupaten Bangka Tengah", "Kabupaten Belitung", "Kabupaten Belitung Timur"] },
    { name: "Kepulauan Riau", cities: ["Kota Batam", "Kota Tanjungpinang", "Kabupaten Bintan", "Kabupaten Karimun", "Kabupaten Kepulauan Anambas", "Kabupaten Lingga", "Kabupaten Natuna"] },
    { name: "DKI Jakarta", cities: ["Jakarta Pusat", "Jakarta Utara", "Jakarta Barat", "Jakarta Selatan", "Jakarta Timur", "Kepulauan Seribu"] },
    { name: "Jawa Barat", cities: ["Kota Bandung", "Kota Banjar", "Kota Bekasi", "Kota Bogor", "Kota Cimahi", "Kota Cirebon", "Kota Depok", "Kota Sukabumi", "Kota Tasikmalaya", "Kabupaten Bandung", "Kabupaten Bandung Barat", "Kabupaten Bekasi", "Kabupaten Bogor", "Kabupaten Ciamis", "Kabupaten Cianjur", "Kabupaten Cirebon", "Kabupaten Garut", "Kabupaten Indramayu", "Kabupaten Karawang", "Kabupaten Kuningan", "Kabupaten Majalengka", "Kabupaten Pangandaran", "Kabupaten Purwakarta", "Kabupaten Subang", "Kabupaten Sukabumi", "Kabupaten Sumedang", "Kabupaten Tasikmalaya"] },
    { name: "Jawa Tengah", cities: ["Kota Semarang", "Kota Magelang", "Kota Pekalongan", "Kota Salatiga", "Kota Surakarta", "Kota Tegal", "Kabupaten Banjarnegara", "Kabupaten Banyumas", "Kabupaten Batang", "Kabupaten Blora", "Kabupaten Boyolali", "Kabupaten Brebes", "Kabupaten Cilacap", "Kabupaten Demak", "Kabupaten Grobogan", "Kabupaten Jepara", "Kabupaten Karanganyar", "Kabupaten Kebumen", "Kabupaten Kendal", "Kabupaten Klaten", "Kabupaten Kudus", "Kabupaten Magelang", "Kabupaten Pati", "Kabupaten Pekalongan", "Kabupaten Pemalang", "Kabupaten Purbalingga", "Kabupaten Purworejo", "Kabupaten Rembang", "Kabupaten Semarang", "Kabupaten Sragen", "Kabupaten Sukoharjo", "Kabupaten Tegal", "Kabupaten Temanggung", "Kabupaten Wonogiri", "Kabupaten Wonosobo"] },
    { name: "DI Yogyakarta", cities: ["Kota Yogyakarta", "Kabupaten Bantul", "Kabupaten Gunungkidul", "Kabupaten Kulon Progo", "Kabupaten Sleman"] },
    { name: "Jawa Timur", cities: ["Kota Surabaya", "Kota Batu", "Kota Blitar", "Kota Kediri", "Kota Madiun", "Kota Malang", "Kota Mojokerto", "Kota Pasuruan", "Kota Probolinggo", "Kabupaten Bangkalan", "Kabupaten Banyuwangi", "Kabupaten Blitar", "Kabupaten Bojonegoro", "Kabupaten Bondowoso", "Kabupaten Gresik", "Kabupaten Jember", "Kabupaten Jombang", "Kabupaten Kediri", "Kabupaten Lamongan", "Kabupaten Lumajang", "Kabupaten Madiun", "Kabupaten Magetan", "Kabupaten Malang", "Kabupaten Mojokerto", "Kabupaten Nganjuk", "Kabupaten Ngawi", "Kabupaten Pacitan", "Kabupaten Pamekasan", "Kabupaten Pasuruan", "Kabupaten Ponorogo", "Kabupaten Probolinggo", "Kabupaten Sampang", "Kabupaten Sidoarjo", "Kabupaten Situbondo", "Kabupaten Sumenep", "Kabupaten Trenggalek", "Kabupaten Tuban", "Kabupaten Tulungagung"] },
    { name: "Banten", cities: ["Kota Serang", "Kota Cilegon", "Kota Tangerang", "Kota Tangerang Selatan", "Kabupaten Lebak", "Kabupaten Pandeglang", "Kabupaten Serang", "Kabupaten Tangerang"] },
    { name: "Bali", cities: ["Kota Denpasar", "Kabupaten Badung", "Kabupaten Bangli", "Kabupaten Buleleng", "Kabupaten Gianyar", "Kabupaten Jembrana", "Kabupaten Karangasem", "Kabupaten Klungkung", "Kabupaten Tabanan"] },
    { name: "Nusa Tenggara Barat", cities: ["Kota Mataram", "Kota Bima", "Kabupaten Bima", "Kabupaten Dompu", "Kabupaten Lombok Barat", "Kabupaten Lombok Tengah", "Kabupaten Lombok Timur", "Kabupaten Lombok Utara", "Kabupaten Sumbawa", "Kabupaten Sumbawa Barat"] },
    { name: "Nusa Tenggara Timur", cities: ["Kota Kupang", "Kabupaten Alor", "Kabupaten Belu", "Kabupaten Ende", "Kabupaten Flores Timur", "Kabupaten Kupang", "Kabupaten Lembata", "Kabupaten Malaka", "Kabupaten Manggarai", "Kabupaten Manggarai Barat", "Kabupaten Manggarai Timur", "Kabupaten Nagekeo", "Kabupaten Ngada", "Kabupaten Rote Ndao", "Kabupaten Sabu Raijua", "Kabupaten Sikka", "Kabupaten Sumba Barat", "Kabupaten Sumba Barat Daya", "Kabupaten Sumba Tengah", "Kabupaten Sumba Timur", "Kabupaten Timor Tengah Selatan", "Kabupaten Timor Tengah Utara"] },
    { name: "Kalimantan Barat", cities: ["Kota Pontianak", "Kota Singkawang", "Kabupaten Bengkayang", "Kabupaten Kapuas Hulu", "Kabupaten Kayong Utara", "Kabupaten Ketapang", "Kabupaten Kubu Raya", "Kabupaten Landak", "Kabupaten Melawi", "Kabupaten Mempawah", "Kabupaten Sambas", "Kabupaten Sanggau", "Kabupaten Sekadau", "Kabupaten Sintang"] },
    { name: "Kalimantan Tengah", cities: ["Kota Palangka Raya", "Kabupaten Barito Selatan", "Kabupaten Barito Timur", "Kabupaten Barito Utara", "Kabupaten Gunung Mas", "Kabupaten Kapuas", "Kabupaten Katingan", "Kabupaten Kotawaringin Barat", "Kabupaten Kotawaringin Timur", "Kabupaten Lamandau", "Kabupaten Murung Raya", "Kabupaten Pulang Pisau", "Kabupaten Seruyan", "Kabupaten Sukamara"] },
    { name: "Kalimantan Selatan", cities: ["Kota Banjarmasin", "Kota Banjarbaru", "Kabupaten Balangan", "Kabupaten Banjar", "Kabupaten Barito Kuala", "Kabupaten Hulu Sungai Selatan", "Kabupaten Hulu Sungai Tengah", "Kabupaten Hulu Sungai Utara", "Kabupaten Kotabaru", "Kabupaten Tabalong", "Kabupaten Tanah Bumbu", "Kabupaten Tanah Laut", "Kabupaten Tapin"] },
    { name: "Kalimantan Timur", cities: ["Kota Samarinda", "Kota Balikpapan", "Kota Bontang", "Kabupaten Berau", "Kabupaten Kutai Barat", "Kabupaten Kutai Kartanegara", "Kabupaten Kutai Timur", "Kabupaten Mahakam Ulu", "Kabupaten Paser", "Kabupaten Penajam Paser Utara"] },
    { name: "Kalimantan Utara", cities: ["Kota Tarakan", "Kabupaten Bulungan", "Kabupaten Malinau", "Kabupaten Nunukan", "Kabupaten Tana Tidung"] },
    { name: "Sulawesi Utara", cities: ["Kota Manado", "Kota Bitung", "Kota Kotamobagu", "Kota Tomohon", "Kabupaten Bolaang Mongondow", "Kabupaten Bolaang Mongondow Selatan", "Kabupaten Bolaang Mongondow Timur", "Kabupaten Bolaang Mongondow Utara", "Kabupaten Kepulauan Sangihe", "Kabupaten Kepulauan Siau Tagulandang Biaro", "Kabupaten Kepulauan Talaud", "Kabupaten Minahasa", "Kabupaten Minahasa Selatan", "Kabupaten Minahasa Tenggara", "Kabupaten Minahasa Utara"] },
    { name: "Sulawesi Tengah", cities: ["Kota Palu", "Kabupaten Banggai", "Kabupaten Banggai Kepulauan", "Kabupaten Banggai Laut", "Kabupaten Buol", "Kabupaten Donggala", "Kabupaten Morowali", "Kabupaten Morowali Utara", "Kabupaten Parigi Moutong", "Kabupaten Poso", "Kabupaten Sigi", "Kabupaten Tojo Una-Una", "Kabupaten Tolitoli"] },
    { name: "Sulawesi Selatan", cities: ["Kota Makassar", "Kota Palopo", "Kota Parepare", "Kabupaten Bantaeng", "Kabupaten Barru", "Kabupaten Bone", "Kabupaten Bulukumba", "Kabupaten Enrekang", "Kabupaten Gowa", "Kabupaten Jeneponto", "Kabupaten Kepulauan Selayar", "Kabupaten Luwu", "Kabupaten Luwu Timur", "Kabupaten Luwu Utara", "Kabupaten Maros", "Kabupaten Pangkajene dan Kepulauan", "Kabupaten Pinrang", "Kabupaten Sidenreng Rappang", "Kabupaten Sinjai", "Kabupaten Soppeng", "Kabupaten Takalar", "Kabupaten Tana Toraja", "Kabupaten Toraja Utara", "Kabupaten Wajo"] },
    { name: "Sulawesi Tenggara", cities: ["Kota Kendari", "Kota Baubau", "Kabupaten Bombana", "Kabupaten Buton", "Kabupaten Buton Selatan", "Kabupaten Buton Tengah", "Kabupaten Buton Utara", "Kabupaten Kolaka", "Kabupaten Kolaka Timur", "Kabupaten Kolaka Utara", "Kabupaten Konawe", "Kabupaten Konawe Kepulauan", "Kabupaten Konawe Selatan", "Kabupaten Konawe Utara", "Kabupaten Muna", "Kabupaten Muna Barat", "Kabupaten Wakatobi"] },
    { name: "Gorontalo", cities: ["Kota Gorontalo", "Kabupaten Boalemo", "Kabupaten Bone Bolango", "Kabupaten Gorontalo", "Kabupaten Gorontalo Utara", "Kabupaten Pohuwato"] },
    { name: "Sulawesi Barat", cities: ["Kabupaten Majene", "Kabupaten Mamasa", "Kabupaten Mamuju", "Kabupaten Mamuju Tengah", "Kabupaten Pasangkayu", "Kabupaten Polewali Mandar"] },
    { name: "Maluku", cities: ["Kota Ambon", "Kota Tual", "Kabupaten Buru", "Kabupaten Buru Selatan", "Kabupaten Kepulauan Aru", "Kabupaten Kepulauan Tanimbar", "Kabupaten Maluku Barat Daya", "Kabupaten Maluku Tengah", "Kabupaten Maluku Tenggara", "Kabupaten Seram Bagian Barat", "Kabupaten Seram Bagian Timur"] },
    { name: "Maluku Utara", cities: ["Kota Ternate", "Kota Tidore Kepulauan", "Kabupaten Halmahera Barat", "Kabupaten Halmahera Selatan", "Kabupaten Halmahera Tengah", "Kabupaten Halmahera Timur", "Kabupaten Halmahera Utara", "Kabupaten Kepulauan Sula", "Kabupaten Pulau Morotai", "Kabupaten Pulau Taliabu"] },
    { name: "Papua", cities: ["Kota Jayapura", "Kabupaten Biak Numfor", "Kabupaten Jayapura", "Kabupaten Keerom", "Kabupaten Kepulauan Yapen", "Kabupaten Mamberamo Raya", "Kabupaten Sarmi", "Kabupaten Supiori", "Kabupaten Waropen"] },
    { name: "Papua Barat", cities: ["Kabupaten Fakfak", "Kabupaten Kaimana", "Kabupaten Manokwari", "Kabupaten Manokwari Selatan", "Kabupaten Pegunungan Arfak", "Kabupaten Teluk Bintuni", "Kabupaten Teluk Wondama"] },
    { name: "Papua Selatan", cities: ["Kabupaten Asmat", "Kabupaten Boven Digoel", "Kabupaten Mappi", "Kabupaten Merauke"] },
    { name: "Papua Tengah", cities: ["Kabupaten Deiyai", "Kabupaten Dogiyai", "Kabupaten Intan Jaya", "Kabupaten Mimika", "Kabupaten Nabire", "Kabupaten Paniai", "Kabupaten Puncak", "Kabupaten Puncak Jaya"] },
    { name: "Papua Pegunungan", cities: ["Kabupaten Jayawijaya", "Kabupaten Lanny Jaya", "Kabupaten Mamberamo Tengah", "Kabupaten Nduga", "Kabupaten Pegunungan Bintang", "Kabupaten Tolikara", "Kabupaten Yahukimo", "Kabupaten Yalimo"] },
    { name: "Papua Barat Daya", cities: ["Kota Sorong", "Kabupaten Maybrat", "Kabupaten Raja Ampat", "Kabupaten Sorong", "Kabupaten Sorong Selatan", "Kabupaten Tambrauw"] },
  ],
  IE: [
    { name: "Dublin", cities: ["Dublin"] },
    { name: "Cork", cities: ["Cork"] },
    { name: "Limerick", cities: ["Limerick"] },
    { name: "Galway", cities: ["Galway"] },
  ],
  IL: [
    { name: "Jerusalem", cities: ["Jerusalem"] },
    { name: "Tel Aviv", cities: ["Tel Aviv"] },
    { name: "Haifa", cities: ["Haifa"] },
    { name: "Southern", cities: ["Beersheba"] },
  ],
  IM: [
    { name: "Isle of Man", cities: ["Douglas"] },
  ],
  IN: [
    { name: "Maharashtra", cities: ["Mumbai", "Pune", "Nagpur"] },
    { name: "Delhi", cities: ["New Delhi", "Delhi"] },
    { name: "Karnataka", cities: ["Bengaluru", "Mysuru"] },
    { name: "Tamil Nadu", cities: ["Chennai", "Coimbatore"] },
    { name: "Telangana", cities: ["Hyderabad"] },
    { name: "West Bengal", cities: ["Kolkata"] },
    { name: "Gujarat", cities: ["Ahmedabad", "Surat"] },
    { name: "Rajasthan", cities: ["Jaipur"] },
    { name: "Uttar Pradesh", cities: ["Lucknow", "Kanpur", "Noida"] },
    { name: "Kerala", cities: ["Kochi", "Thiruvananthapuram"] },
  ],
  IO: [
    { name: "British Indian Ocean Territory", cities: ["Diego Garcia"] },
  ],
  IQ: [
    { name: "Baghdad", cities: ["Baghdad"] },
    { name: "Basra", cities: ["Basra"] },
    { name: "Nineveh", cities: ["Mosul"] },
    { name: "Erbil", cities: ["Erbil"] },
  ],
  IR: [
    { name: "Tehran", cities: ["Tehran"] },
    { name: "Razavi Khorasan", cities: ["Mashhad"] },
    { name: "Isfahan", cities: ["Isfahan"] },
    { name: "Fars", cities: ["Shiraz"] },
    { name: "East Azerbaijan", cities: ["Tabriz"] },
  ],
  IS: [
    { name: "Capital Region", cities: ["Reykjavík"] },
    { name: "Northeastern", cities: ["Akureyri"] },
  ],
  IT: [
    { name: "Lazio", cities: ["Rome"] },
    { name: "Lombardy", cities: ["Milan", "Bergamo", "Brescia"] },
    { name: "Campania", cities: ["Naples"] },
    { name: "Piedmont", cities: ["Turin"] },
    { name: "Veneto", cities: ["Venice", "Verona", "Padua"] },
    { name: "Tuscany", cities: ["Florence"] },
    { name: "Sicily", cities: ["Palermo", "Catania"] },
  ],
  JE: [
    { name: "Jersey", cities: ["Saint Helier"] },
  ],
  JM: [
    { name: "Surrey", cities: ["Kingston"] },
    { name: "Cornwall", cities: ["Montego Bay"] },
  ],
  JO: [
    { name: "Amman", cities: ["Amman"] },
    { name: "Zarqa", cities: ["Zarqa"] },
    { name: "Irbid", cities: ["Irbid"] },
  ],
  JP: [
    { name: "Tokyo", cities: ["Tokyo"] },
    { name: "Osaka", cities: ["Osaka", "Sakai"] },
    { name: "Kanagawa", cities: ["Yokohama", "Kawasaki"] },
    { name: "Aichi", cities: ["Nagoya"] },
    { name: "Hokkaido", cities: ["Sapporo"] },
    { name: "Fukuoka", cities: ["Fukuoka", "Kitakyushu"] },
    { name: "Kyoto", cities: ["Kyoto"] },
    { name: "Hyogo", cities: ["Kobe", "Himeji"] },
  ],
  KE: [
    { name: "Nairobi", cities: ["Nairobi"] },
    { name: "Mombasa", cities: ["Mombasa"] },
    { name: "Kisumu", cities: ["Kisumu"] },
    { name: "Nakuru", cities: ["Nakuru"] },
  ],
  KG: [
    { name: "Bishkek", cities: ["Bishkek"] },
    { name: "Osh", cities: ["Osh"] },
  ],
  KH: [
    { name: "Phnom Penh", cities: ["Phnom Penh"] },
    { name: "Siem Reap", cities: ["Siem Reap"] },
    { name: "Battambang", cities: ["Battambang"] },
  ],
  KI: [
    { name: "Tarawa", cities: ["South Tarawa"] },
  ],
  KM: [
    { name: "Grande Comore", cities: ["Moroni"] },
  ],
  KN: [
    { name: "Saint Kitts", cities: ["Basseterre"] },
    { name: "Nevis", cities: ["Charlestown"] },
  ],
  KP: [
    { name: "Pyongyang", cities: ["Pyongyang"] },
    { name: "South Hamgyong", cities: ["Hamhung"] },
  ],
  KR: [
    { name: "Seoul", cities: ["Seoul"] },
    { name: "Busan", cities: ["Busan"] },
    { name: "Incheon", cities: ["Incheon"] },
    { name: "Gyeonggi", cities: ["Suwon", "Seongnam", "Goyang"] },
    { name: "Daegu", cities: ["Daegu"] },
  ],
  KW: [
    { name: "Al Asimah", cities: ["Kuwait City"] },
    { name: "Hawalli", cities: ["Hawalli"] },
  ],
  KY: [
    { name: "Grand Cayman", cities: ["George Town"] },
  ],
  KZ: [
    { name: "Astana", cities: ["Astana"] },
    { name: "Almaty", cities: ["Almaty"] },
    { name: "Shymkent", cities: ["Shymkent"] },
  ],
  LA: [
    { name: "Vientiane", cities: ["Vientiane"] },
    { name: "Luang Prabang", cities: ["Luang Prabang"] },
  ],
  LB: [
    { name: "Beirut", cities: ["Beirut"] },
    { name: "North", cities: ["Tripoli"] },
    { name: "South", cities: ["Sidon"] },
  ],
  LC: [
    { name: "Castries", cities: ["Castries"] },
  ],
  LI: [
    { name: "Vaduz", cities: ["Vaduz"] },
    { name: "Schaan", cities: ["Schaan"] },
  ],
  LK: [
    { name: "Western", cities: ["Colombo", "Sri Jayawardenepura Kotte"] },
    { name: "Central", cities: ["Kandy"] },
    { name: "Southern", cities: ["Galle"] },
    { name: "Northern", cities: ["Jaffna"] },
  ],
  LR: [
    { name: "Montserrado", cities: ["Monrovia"] },
  ],
  LS: [
    { name: "Maseru", cities: ["Maseru"] },
  ],
  LT: [
    { name: "Vilnius", cities: ["Vilnius"] },
    { name: "Kaunas", cities: ["Kaunas"] },
    { name: "Klaipėda", cities: ["Klaipėda"] },
  ],
  LU: [
    { name: "Luxembourg", cities: ["Luxembourg City"] },
    { name: "Esch-sur-Alzette", cities: ["Esch-sur-Alzette"] },
  ],
  LV: [
    { name: "Riga", cities: ["Riga"] },
    { name: "Latgale", cities: ["Daugavpils"] },
    { name: "Kurzeme", cities: ["Liepāja"] },
  ],
  LY: [
    { name: "Tripoli", cities: ["Tripoli"] },
    { name: "Benghazi", cities: ["Benghazi"] },
    { name: "Misrata", cities: ["Misrata"] },
  ],
  MA: [
    { name: "Rabat-Salé-Kénitra", cities: ["Rabat", "Salé"] },
    { name: "Casablanca-Settat", cities: ["Casablanca"] },
    { name: "Marrakesh-Safi", cities: ["Marrakesh"] },
    { name: "Fès-Meknès", cities: ["Fez"] },
    { name: "Tanger-Tétouan", cities: ["Tangier"] },
  ],
  MC: [
    { name: "Monaco", cities: ["Monaco", "Monte Carlo"] },
  ],
  MD: [
    { name: "Chișinău", cities: ["Chișinău"] },
    { name: "Transnistria", cities: ["Tiraspol"] },
    { name: "Bălți", cities: ["Bălți"] },
  ],
  ME: [
    { name: "Podgorica", cities: ["Podgorica"] },
    { name: "Nikšić", cities: ["Nikšić"] },
  ],
  MF: [
    { name: "Saint Martin", cities: ["Marigot"] },
  ],
  MG: [
    { name: "Analamanga", cities: ["Antananarivo"] },
    { name: "Atsinanana", cities: ["Toamasina"] },
  ],
  MH: [
    { name: "Majuro", cities: ["Majuro"] },
  ],
  MK: [
    { name: "Skopje", cities: ["Skopje"] },
    { name: "Pelagonia", cities: ["Bitola"] },
  ],
  ML: [
    { name: "Bamako", cities: ["Bamako"] },
    { name: "Sikasso", cities: ["Sikasso"] },
  ],
  MM: [
    { name: "Naypyidaw", cities: ["Naypyidaw"] },
    { name: "Yangon", cities: ["Yangon"] },
    { name: "Mandalay", cities: ["Mandalay"] },
  ],
  MN: [
    { name: "Ulaanbaatar", cities: ["Ulaanbaatar"] },
    { name: "Orkhon", cities: ["Erdenet"] },
  ],
  MO: [
    { name: "Macao", cities: ["Macau"] },
  ],
  MP: [
    { name: "Saipan", cities: ["Saipan"] },
  ],
  MQ: [
    { name: "Martinique", cities: ["Fort-de-France"] },
  ],
  MR: [
    { name: "Nouakchott", cities: ["Nouakchott"] },
    { name: "Dakhlet Nouadhibou", cities: ["Nouadhibou"] },
  ],
  MS: [
    { name: "Montserrat", cities: ["Brades"] },
  ],
  MT: [
    { name: "Valletta", cities: ["Valletta"] },
    { name: "Northern Harbour", cities: ["Birkirkara"] },
  ],
  MU: [
    { name: "Port Louis", cities: ["Port Louis"] },
    { name: "Plaines Wilhems", cities: ["Curepipe"] },
  ],
  MV: [
    { name: "Malé", cities: ["Malé"] },
  ],
  MW: [
    { name: "Central", cities: ["Lilongwe"] },
    { name: "Southern", cities: ["Blantyre"] },
  ],
  MX: [
    { name: "Mexico City", cities: ["Mexico City"] },
    { name: "Jalisco", cities: ["Guadalajara"] },
    { name: "Nuevo León", cities: ["Monterrey"] },
    { name: "Puebla", cities: ["Puebla"] },
    { name: "Baja California", cities: ["Tijuana"] },
  ],
  MY: [
    { name: "Kuala Lumpur", cities: ["Kuala Lumpur"] },
    { name: "Selangor", cities: ["Shah Alam", "Petaling Jaya", "Subang Jaya", "Klang"] },
    { name: "Penang", cities: ["George Town", "Butterworth"] },
    { name: "Johor", cities: ["Johor Bahru", "Iskandar Puteri"] },
    { name: "Sabah", cities: ["Kota Kinabalu", "Sandakan"] },
    { name: "Sarawak", cities: ["Kuching", "Miri"] },
    { name: "Perak", cities: ["Ipoh"] },
    { name: "Malacca", cities: ["Malacca City"] },
    { name: "Negeri Sembilan", cities: ["Seremban"] },
    { name: "Putrajaya", cities: ["Putrajaya"] },
  ],
  MZ: [
    { name: "Maputo", cities: ["Maputo", "Matola"] },
    { name: "Sofala", cities: ["Beira"] },
    { name: "Nampula", cities: ["Nampula"] },
  ],
  NA: [
    { name: "Khomas", cities: ["Windhoek"] },
    { name: "Erongo", cities: ["Walvis Bay"] },
  ],
  NC: [
    { name: "South Province", cities: ["Nouméa"] },
  ],
  NE: [
    { name: "Niamey", cities: ["Niamey"] },
    { name: "Zinder", cities: ["Zinder"] },
  ],
  NF: [
    { name: "Norfolk Island", cities: ["Kingston"] },
  ],
  NG: [
    { name: "Federal Capital Territory", cities: ["Abuja"] },
    { name: "Lagos", cities: ["Lagos"] },
    { name: "Kano", cities: ["Kano"] },
    { name: "Oyo", cities: ["Ibadan"] },
    { name: "Rivers", cities: ["Port Harcourt"] },
  ],
  NI: [
    { name: "Managua", cities: ["Managua"] },
    { name: "León", cities: ["León"] },
  ],
  NL: [
    { name: "North Holland", cities: ["Amsterdam", "Haarlem"] },
    { name: "South Holland", cities: ["Rotterdam", "The Hague", "Leiden"] },
    { name: "Utrecht", cities: ["Utrecht"] },
    { name: "North Brabant", cities: ["Eindhoven", "Tilburg"] },
  ],
  NO: [
    { name: "Oslo", cities: ["Oslo"] },
    { name: "Vestland", cities: ["Bergen"] },
    { name: "Trøndelag", cities: ["Trondheim"] },
    { name: "Rogaland", cities: ["Stavanger"] },
  ],
  NP: [
    { name: "Bagmati", cities: ["Kathmandu", "Lalitpur"] },
    { name: "Gandaki", cities: ["Pokhara"] },
  ],
  NR: [
    { name: "Yaren", cities: ["Yaren"] },
  ],
  NU: [
    { name: "Niue", cities: ["Alofi"] },
  ],
  NZ: [
    { name: "Auckland", cities: ["Auckland"] },
    { name: "Wellington", cities: ["Wellington"] },
    { name: "Canterbury", cities: ["Christchurch"] },
    { name: "Otago", cities: ["Dunedin"] },
    { name: "Waikato", cities: ["Hamilton"] },
  ],
  OM: [
    { name: "Muscat", cities: ["Muscat"] },
    { name: "Dhofar", cities: ["Salalah"] },
    { name: "North Al Batinah", cities: ["Sohar"] },
  ],
  PA: [
    { name: "Panamá", cities: ["Panama City"] },
    { name: "Colón", cities: ["Colón"] },
  ],
  PE: [
    { name: "Lima", cities: ["Lima", "Callao"] },
    { name: "Arequipa", cities: ["Arequipa"] },
    { name: "La Libertad", cities: ["Trujillo"] },
    { name: "Cusco", cities: ["Cusco"] },
  ],
  PF: [
    { name: "Tahiti", cities: ["Papeete"] },
  ],
  PG: [
    { name: "National Capital District", cities: ["Port Moresby"] },
    { name: "Morobe", cities: ["Lae"] },
  ],
  PH: [
    { name: "Metro Manila", cities: ["Manila", "Quezon City", "Makati", "Taguig", "Pasig"] },
    { name: "Cebu", cities: ["Cebu City", "Mandaue", "Lapu-Lapu"] },
    { name: "Davao", cities: ["Davao City"] },
  ],
  PK: [
    { name: "Islamabad", cities: ["Islamabad"] },
    { name: "Sindh", cities: ["Karachi"] },
    { name: "Punjab", cities: ["Lahore", "Faisalabad", "Rawalpindi"] },
    { name: "Khyber Pakhtunkhwa", cities: ["Peshawar"] },
  ],
  PL: [
    { name: "Masovia", cities: ["Warsaw"] },
    { name: "Lesser Poland", cities: ["Kraków"] },
    { name: "Łódź", cities: ["Łódź"] },
    { name: "Lower Silesia", cities: ["Wrocław"] },
    { name: "Greater Poland", cities: ["Poznań"] },
    { name: "Pomerania", cities: ["Gdańsk"] },
  ],
  PM: [
    { name: "Saint-Pierre", cities: ["Saint-Pierre"] },
  ],
  PN: [
    { name: "Pitcairn", cities: ["Adamstown"] },
  ],
  PR: [
    { name: "San Juan", cities: ["San Juan"] },
    { name: "Ponce", cities: ["Ponce"] },
    { name: "Bayamón", cities: ["Bayamón"] },
  ],
  PS: [
    { name: "West Bank", cities: ["Ramallah", "Hebron", "Nablus"] },
    { name: "Gaza Strip", cities: ["Gaza"] },
  ],
  PT: [
    { name: "Lisbon", cities: ["Lisbon"] },
    { name: "Porto", cities: ["Porto"] },
    { name: "Braga", cities: ["Braga"] },
    { name: "Coimbra", cities: ["Coimbra"] },
  ],
  PW: [
    { name: "Melekeok", cities: ["Ngerulmud"] },
    { name: "Koror", cities: ["Koror"] },
  ],
  PY: [
    { name: "Asunción", cities: ["Asunción"] },
    { name: "Alto Paraná", cities: ["Ciudad del Este"] },
  ],
  QA: [
    { name: "Doha", cities: ["Doha"] },
    { name: "Al Rayyan", cities: ["Al Rayyan"] },
    { name: "Al Wakrah", cities: ["Al Wakrah"] },
  ],
  RE: [
    { name: "Réunion", cities: ["Saint-Denis", "Saint-Paul"] },
  ],
  RO: [
    { name: "Bucharest", cities: ["Bucharest"] },
    { name: "Cluj", cities: ["Cluj-Napoca"] },
    { name: "Timiș", cities: ["Timișoara"] },
    { name: "Iași", cities: ["Iași"] },
  ],
  RS: [
    { name: "Belgrade", cities: ["Belgrade"] },
    { name: "Vojvodina", cities: ["Novi Sad"] },
    { name: "Nišava", cities: ["Niš"] },
  ],
  RU: [
    { name: "Moscow", cities: ["Moscow"] },
    { name: "Saint Petersburg", cities: ["Saint Petersburg"] },
    { name: "Novosibirsk Oblast", cities: ["Novosibirsk"] },
    { name: "Sverdlovsk Oblast", cities: ["Yekaterinburg"] },
    { name: "Tatarstan", cities: ["Kazan"] },
    { name: "Nizhny Novgorod Oblast", cities: ["Nizhny Novgorod"] },
  ],
  RW: [
    { name: "Kigali", cities: ["Kigali"] },
  ],
  SA: [
    { name: "Riyadh", cities: ["Riyadh"] },
    { name: "Makkah", cities: ["Mecca", "Jeddah", "Taif"] },
    { name: "Eastern Province", cities: ["Dammam", "Khobar", "Dhahran"] },
    { name: "Madinah", cities: ["Medina"] },
  ],
  SB: [
    { name: "Guadalcanal", cities: ["Honiara"] },
  ],
  SC: [
    { name: "Mahé", cities: ["Victoria"] },
  ],
  SD: [
    { name: "Khartoum", cities: ["Khartoum", "Omdurman"] },
    { name: "Red Sea", cities: ["Port Sudan"] },
  ],
  SE: [
    { name: "Stockholm", cities: ["Stockholm"] },
    { name: "Västra Götaland", cities: ["Gothenburg"] },
    { name: "Skåne", cities: ["Malmö"] },
    { name: "Uppsala", cities: ["Uppsala"] },
  ],
  SG: [
    { name: "Central Region", cities: ["Singapore", "Orchard", "Bukit Merah", "Toa Payoh"] },
    { name: "East Region", cities: ["Bedok", "Tampines", "Pasir Ris", "Changi"] },
    { name: "North Region", cities: ["Woodlands", "Yishun", "Sembawang"] },
    { name: "North-East Region", cities: ["Hougang", "Sengkang", "Punggol", "Serangoon"] },
    { name: "West Region", cities: ["Jurong East", "Jurong West", "Clementi", "Bukit Batok"] },
  ],
  SH: [
    { name: "Saint Helena", cities: ["Jamestown"] },
  ],
  SI: [
    { name: "Ljubljana", cities: ["Ljubljana"] },
    { name: "Maribor", cities: ["Maribor"] },
  ],
  SJ: [
    { name: "Svalbard", cities: ["Longyearbyen"] },
  ],
  SK: [
    { name: "Bratislava", cities: ["Bratislava"] },
    { name: "Košice", cities: ["Košice"] },
  ],
  SL: [
    { name: "Western Area", cities: ["Freetown"] },
    { name: "Southern", cities: ["Bo"] },
  ],
  SM: [
    { name: "San Marino", cities: ["San Marino"] },
    { name: "Serravalle", cities: ["Serravalle"] },
  ],
  SN: [
    { name: "Dakar", cities: ["Dakar"] },
    { name: "Diourbel", cities: ["Touba"] },
    { name: "Thiès", cities: ["Thiès"] },
  ],
  SO: [
    { name: "Banaadir", cities: ["Mogadishu"] },
    { name: "Woqooyi Galbeed", cities: ["Hargeisa"] },
  ],
  SR: [
    { name: "Paramaribo", cities: ["Paramaribo"] },
  ],
  SS: [
    { name: "Central Equatoria", cities: ["Juba"] },
  ],
  ST: [
    { name: "Água Grande", cities: ["São Tomé"] },
  ],
  SV: [
    { name: "San Salvador", cities: ["San Salvador"] },
    { name: "Santa Ana", cities: ["Santa Ana"] },
  ],
  SX: [
    { name: "Sint Maarten", cities: ["Philipsburg"] },
  ],
  SY: [
    { name: "Damascus", cities: ["Damascus"] },
    { name: "Aleppo", cities: ["Aleppo"] },
    { name: "Homs", cities: ["Homs"] },
    { name: "Latakia", cities: ["Latakia"] },
  ],
  SZ: [
    { name: "Hhohho", cities: ["Mbabane"] },
    { name: "Manzini", cities: ["Manzini"] },
  ],
  TC: [
    { name: "Grand Turk", cities: ["Cockburn Town"] },
    { name: "Providenciales", cities: ["Providenciales"] },
  ],
  TD: [
    { name: "N'Djamena", cities: ["N'Djamena"] },
    { name: "Logone Occidental", cities: ["Moundou"] },
  ],
  TF: [
    { name: "Kerguelen", cities: ["Port-aux-Français"] },
  ],
  TG: [
    { name: "Maritime", cities: ["Lomé"] },
    { name: "Centrale", cities: ["Sokodé"] },
  ],
  TH: [
    { name: "Bangkok", cities: ["Bangkok"] },
    { name: "Chiang Mai", cities: ["Chiang Mai"] },
    { name: "Phuket", cities: ["Phuket"] },
    { name: "Chonburi", cities: ["Pattaya", "Si Racha"] },
    { name: "Nonthaburi", cities: ["Nonthaburi"] },
  ],
  TJ: [
    { name: "Dushanbe", cities: ["Dushanbe"] },
    { name: "Sughd", cities: ["Khujand"] },
  ],
  TK: [
    { name: "Tokelau", cities: ["Nukunonu"] },
  ],
  TL: [
    { name: "Dili", cities: ["Dili"] },
  ],
  TM: [
    { name: "Ashgabat", cities: ["Ashgabat"] },
    { name: "Lebap", cities: ["Türkmenabat"] },
  ],
  TN: [
    { name: "Tunis", cities: ["Tunis"] },
    { name: "Sfax", cities: ["Sfax"] },
    { name: "Sousse", cities: ["Sousse"] },
  ],
  TO: [
    { name: "Tongatapu", cities: ["Nuku'alofa"] },
  ],
  TR: [
    { name: "Ankara", cities: ["Ankara"] },
    { name: "Istanbul", cities: ["Istanbul"] },
    { name: "Izmir", cities: ["Izmir"] },
    { name: "Bursa", cities: ["Bursa"] },
    { name: "Antalya", cities: ["Antalya"] },
  ],
  TT: [
    { name: "Trinidad", cities: ["Port of Spain", "San Fernando", "Chaguanas"] },
    { name: "Tobago", cities: ["Scarborough"] },
  ],
  TV: [
    { name: "Funafuti", cities: ["Funafuti"] },
  ],
  TW: [
    { name: "Taipei", cities: ["Taipei", "New Taipei"] },
    { name: "Kaohsiung", cities: ["Kaohsiung"] },
    { name: "Taichung", cities: ["Taichung"] },
    { name: "Tainan", cities: ["Tainan"] },
  ],
  TZ: [
    { name: "Dodoma", cities: ["Dodoma"] },
    { name: "Dar es Salaam", cities: ["Dar es Salaam"] },
    { name: "Mwanza", cities: ["Mwanza"] },
  ],
  UA: [
    { name: "Kyiv", cities: ["Kyiv"] },
    { name: "Kharkiv", cities: ["Kharkiv"] },
    { name: "Odesa", cities: ["Odesa"] },
    { name: "Dnipropetrovsk", cities: ["Dnipro"] },
    { name: "Lviv", cities: ["Lviv"] },
  ],
  UG: [
    { name: "Central", cities: ["Kampala"] },
    { name: "Northern", cities: ["Gulu"] },
  ],
  UM: [
    { name: "Wake Island", cities: ["Wake Island"] },
  ],
  US: [
    { name: "California", cities: ["Los Angeles", "San Francisco", "San Diego", "San Jose", "Sacramento"] },
    { name: "New York", cities: ["New York City", "Buffalo", "Rochester", "Albany"] },
    { name: "Texas", cities: ["Houston", "Austin", "Dallas", "San Antonio", "Fort Worth"] },
    { name: "Florida", cities: ["Miami", "Orlando", "Tampa", "Jacksonville"] },
    { name: "Illinois", cities: ["Chicago", "Springfield", "Naperville"] },
    { name: "Washington", cities: ["Seattle", "Spokane", "Tacoma"] },
    { name: "Massachusetts", cities: ["Boston", "Cambridge", "Worcester"] },
    { name: "Georgia", cities: ["Atlanta", "Savannah", "Augusta"] },
    { name: "Pennsylvania", cities: ["Philadelphia", "Pittsburgh"] },
    { name: "Arizona", cities: ["Phoenix", "Tucson", "Mesa"] },
    { name: "Colorado", cities: ["Denver", "Boulder", "Colorado Springs"] },
    { name: "Washington DC", cities: ["Washington"] },
  ],
  UY: [
    { name: "Montevideo", cities: ["Montevideo"] },
    { name: "Salto", cities: ["Salto"] },
  ],
  UZ: [
    { name: "Tashkent", cities: ["Tashkent"] },
    { name: "Samarkand", cities: ["Samarkand"] },
    { name: "Bukhara", cities: ["Bukhara"] },
  ],
  VA: [
    { name: "Vatican City", cities: ["Vatican City"] },
  ],
  VC: [
    { name: "Saint George", cities: ["Kingstown"] },
  ],
  VE: [
    { name: "Capital District", cities: ["Caracas"] },
    { name: "Zulia", cities: ["Maracaibo"] },
    { name: "Carabobo", cities: ["Valencia"] },
    { name: "Lara", cities: ["Barquisimeto"] },
  ],
  VG: [
    { name: "Tortola", cities: ["Road Town"] },
  ],
  VI: [
    { name: "Saint Thomas", cities: ["Charlotte Amalie"] },
    { name: "Saint Croix", cities: ["Christiansted"] },
  ],
  VN: [
    { name: "Hanoi", cities: ["Hanoi"] },
    { name: "Ho Chi Minh City", cities: ["Ho Chi Minh City"] },
    { name: "Da Nang", cities: ["Da Nang"] },
    { name: "Hai Phong", cities: ["Hai Phong"] },
    { name: "Can Tho", cities: ["Can Tho"] },
  ],
  VU: [
    { name: "Shefa", cities: ["Port Vila"] },
  ],
  WF: [
    { name: "Wallis", cities: ["Mata-Utu"] },
  ],
  WS: [
    { name: "Tuamasaga", cities: ["Apia"] },
  ],
  YE: [
    { name: "Sana'a", cities: ["Sana'a"] },
    { name: "Aden", cities: ["Aden"] },
    { name: "Taiz", cities: ["Taiz"] },
  ],
  YT: [
    { name: "Mayotte", cities: ["Mamoudzou"] },
  ],
  ZA: [
    { name: "Gauteng", cities: ["Johannesburg", "Pretoria"] },
    { name: "Western Cape", cities: ["Cape Town"] },
    { name: "KwaZulu-Natal", cities: ["Durban"] },
    { name: "Eastern Cape", cities: ["Gqeberha"] },
  ],
  ZM: [
    { name: "Lusaka", cities: ["Lusaka"] },
    { name: "Copperbelt", cities: ["Kitwe", "Ndola"] },
  ],
  ZW: [
    { name: "Harare", cities: ["Harare"] },
    { name: "Bulawayo", cities: ["Bulawayo"] },
  ],
};
