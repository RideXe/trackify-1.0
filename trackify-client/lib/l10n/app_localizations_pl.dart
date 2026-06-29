// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Polish (`pl`).
class AppLocalizationsPl extends AppLocalizations {
  AppLocalizationsPl([String locale = 'pl']) : super(locale);

  @override
  String get trackingTitle => 'Śledzenie';

  @override
  String get settingsTitle => 'Ustawienia';

  @override
  String get statusTitle => 'Dzienniki';

  @override
  String get saveButton => 'Zapisz';

  @override
  String get cancelButton => 'Anuluj';

  @override
  String get okButton => 'OK';

  @override
  String get locationButton => 'Wyślij lokalizację';

  @override
  String get statusButton => 'Pokaż status';

  @override
  String get settingsButton => 'Zmień ustawienia';

  @override
  String get invalidValue => 'Nieprawidłowa wartość';

  @override
  String get disabledValue => 'Wyłączone';

  @override
  String get idLabel => 'Identyfikator urządzenia';

  @override
  String get urlLabel => 'URL serwera';

  @override
  String get accuracyLabel => 'Dokładność lokalizacji';

  @override
  String get highestAccuracyLabel => 'Najwyższa';

  @override
  String get highAccuracyLabel => 'Wysoka';

  @override
  String get mediumAccuracyLabel => 'Średnia';

  @override
  String get lowAccuracyLabel => 'Niska';

  @override
  String get intervalLabel => 'Interwał (sekundy)';

  @override
  String get fastestIntervalLabel => 'Najszybszy interwał (sekundy)';

  @override
  String get distanceLabel => 'Dystans (metry)';

  @override
  String get angleLabel => 'Kąt (stopnie)';

  @override
  String get heartbeatLabel => 'Interwał w bezruchu (sekundy)';

  @override
  String get bufferLabel => 'Buforowanie offline';

  @override
  String get wakelockLabel => 'Blokada uśpienia';

  @override
  String get stopDetectionLabel => 'Wykrywanie zatrzymania';

  @override
  String get preferPlatformProvidersLabel => 'Use system location';

  @override
  String get trackingLabel => 'Ciągłe śledzenie';

  @override
  String get advancedLabel => 'Ustawienia zaawansowane';

  @override
  String get passwordLabel => 'Hasło';

  @override
  String get optimizationMessage =>
      'Aby zapewnić niezawodne śledzenie, wyłącz optymalizację baterii dla tej aplikacji.';

  @override
  String get passwordError => 'Błędne hasło';

  @override
  String get startAction => 'Uruchom usługę';

  @override
  String get stopAction => 'Zatrzymaj usługę';

  @override
  String get sosAction => 'Wyślij SOS';

  @override
  String get disclosureMessage =>
      'Ta aplikacja zbiera w tle dane dotyczące lokalizacji i aktywności i wysyła je na skonfigurowany serwer.';

  @override
  String get configurationMessage => 'Apply new configuration?';
}
