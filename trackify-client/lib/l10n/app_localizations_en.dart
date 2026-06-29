// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for English (`en`).
class AppLocalizationsEn extends AppLocalizations {
  AppLocalizationsEn([String locale = 'en']) : super(locale);

  @override
  String get trackingTitle => 'Tracking';

  @override
  String get settingsTitle => 'Settings';

  @override
  String get statusTitle => 'Logs';

  @override
  String get saveButton => 'Save';

  @override
  String get cancelButton => 'Cancel';

  @override
  String get okButton => 'OK';

  @override
  String get locationButton => 'Send location';

  @override
  String get statusButton => 'Show status';

  @override
  String get settingsButton => 'Change settings';

  @override
  String get invalidValue => 'Invalid value';

  @override
  String get disabledValue => 'Disabled';

  @override
  String get idLabel => 'Device identifier';

  @override
  String get urlLabel => 'Server URL';

  @override
  String get accuracyLabel => 'Location accuracy';

  @override
  String get highestAccuracyLabel => 'Highest';

  @override
  String get highAccuracyLabel => 'High';

  @override
  String get mediumAccuracyLabel => 'Medium';

  @override
  String get lowAccuracyLabel => 'Low';

  @override
  String get intervalLabel => 'Interval (seconds)';

  @override
  String get fastestIntervalLabel => 'Fastest interval (seconds)';

  @override
  String get distanceLabel => 'Distance (meters)';

  @override
  String get angleLabel => 'Angle (degrees)';

  @override
  String get heartbeatLabel => 'Stationary heartbeat (seconds)';

  @override
  String get bufferLabel => 'Offline buffering';

  @override
  String get wakelockLabel => 'Wake lock';

  @override
  String get stopDetectionLabel => 'Stop detection';

  @override
  String get preferPlatformProvidersLabel => 'Use system location';

  @override
  String get trackingLabel => 'Continuous tracking';

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
  String get startAction => 'Start service';

  @override
  String get stopAction => 'Stop service';

  @override
  String get sosAction => 'Send SOS';

  @override
  String get disclosureMessage =>
      'This app collects location and activity data in the background and sends it to the configured server.';

  @override
  String get configurationMessage => 'Apply new configuration?';
}
