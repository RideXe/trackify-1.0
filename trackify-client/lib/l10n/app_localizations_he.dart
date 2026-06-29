// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Hebrew (`he`).
class AppLocalizationsHe extends AppLocalizations {
  AppLocalizationsHe([String locale = 'he']) : super(locale);

  @override
  String get trackingTitle => 'מעקב';

  @override
  String get settingsTitle => 'הגדרות';

  @override
  String get statusTitle => 'יומן';

  @override
  String get saveButton => 'שמירה';

  @override
  String get cancelButton => 'בטל';

  @override
  String get okButton => 'OK';

  @override
  String get locationButton => 'שלח מיקום';

  @override
  String get statusButton => 'הצג מצב';

  @override
  String get settingsButton => 'שנה הגדרות';

  @override
  String get invalidValue => 'ערך לא חוקי';

  @override
  String get disabledValue => 'Disabled';

  @override
  String get idLabel => 'מזהה המכשיר';

  @override
  String get urlLabel => 'כתובת השרת';

  @override
  String get accuracyLabel => 'דיוק מיקום';

  @override
  String get highestAccuracyLabel => 'Highest';

  @override
  String get highAccuracyLabel => 'גבוהה';

  @override
  String get mediumAccuracyLabel => 'בינוני';

  @override
  String get lowAccuracyLabel => 'נמוך';

  @override
  String get intervalLabel => 'תדירות (שניות)';

  @override
  String get fastestIntervalLabel => 'Fastest interval (seconds)';

  @override
  String get distanceLabel => 'מרחק (מטר)';

  @override
  String get angleLabel => 'Angle (degrees)';

  @override
  String get heartbeatLabel => 'Stationary heartbeat (seconds)';

  @override
  String get bufferLabel => 'אחסון לא מקוון';

  @override
  String get wakelockLabel => 'Wake lock';

  @override
  String get stopDetectionLabel => 'Stop detection';

  @override
  String get preferPlatformProvidersLabel => 'Use system location';

  @override
  String get trackingLabel => 'מעקב רציף';

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
  String get startAction => 'התחל מעקב';

  @override
  String get stopAction => 'עצור מעקב';

  @override
  String get sosAction => 'שלח SOS';

  @override
  String get disclosureMessage =>
      'This app collects location and activity data in the background and sends it to the configured server.';

  @override
  String get configurationMessage => 'Apply new configuration?';
}
