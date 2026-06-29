// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Catalan Valencian (`ca`).
class AppLocalizationsCa extends AppLocalizations {
  AppLocalizationsCa([String locale = 'ca']) : super(locale);

  @override
  String get trackingTitle => 'Seguiment';

  @override
  String get settingsTitle => 'Preferències';

  @override
  String get statusTitle => 'Registres';

  @override
  String get saveButton => 'Guardar';

  @override
  String get cancelButton => 'Cancel·lar';

  @override
  String get okButton => 'OK';

  @override
  String get locationButton => 'Envia ubicació';

  @override
  String get statusButton => 'Mostra l\'estat';

  @override
  String get settingsButton => 'Canvia la configuració';

  @override
  String get invalidValue => 'Valor no vàlid';

  @override
  String get disabledValue => 'Disabled';

  @override
  String get idLabel => 'Identificador del dispositiu';

  @override
  String get urlLabel => 'URL del servidor';

  @override
  String get accuracyLabel => 'Precisió de la ubicació';

  @override
  String get highestAccuracyLabel => 'Highest';

  @override
  String get highAccuracyLabel => 'Alta';

  @override
  String get mediumAccuracyLabel => 'Mitjana';

  @override
  String get lowAccuracyLabel => 'Baixa';

  @override
  String get intervalLabel => 'Interval (segons)';

  @override
  String get fastestIntervalLabel => 'Fastest interval (seconds)';

  @override
  String get distanceLabel => 'Distància (metres)';

  @override
  String get angleLabel => 'Angle (degrees)';

  @override
  String get heartbeatLabel => 'Stationary heartbeat (seconds)';

  @override
  String get bufferLabel => 'Memòria intermèdia fora de línia';

  @override
  String get wakelockLabel => 'Wake lock';

  @override
  String get stopDetectionLabel => 'Stop detection';

  @override
  String get preferPlatformProvidersLabel => 'Use system location';

  @override
  String get trackingLabel => 'Seguiment continu';

  @override
  String get advancedLabel => 'Advanced settings';

  @override
  String get passwordLabel => 'Password';

  @override
  String get optimizationMessage =>
      'To ensure reliable tracking, please disable battery optimization for this app.';

  @override
  String get passwordError => 'Wrong password';

  @override
  String get startAction => 'Inicia el servei';

  @override
  String get stopAction => 'Atura el servei';

  @override
  String get sosAction => 'Envia SOS';

  @override
  String get disclosureMessage =>
      'This app collects location and activity data in the background and sends it to the configured server.';

  @override
  String get configurationMessage => 'Apply new configuration?';
}
