import { Stack } from 'aws-cdk-lib';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import type { Function as LambdaFunction } from 'aws-cdk-lib/aws-lambda';
import type { EnvConfig } from '../config';

/** Turns reverse geocoding on for a function when the environment enables it. */
export function allowGeocoding(fn: LambdaFunction, config: EnvConfig) {
  if (!config.geocoding) return;
  fn.addEnvironment('GEOCODING', 'on');
  fn.addToRolePolicy(
    new PolicyStatement({
      actions: ['geo-places:ReverseGeocode'],
      resources: [`arn:aws:geo-places:${Stack.of(fn).region}::provider/default`],
    }),
  );
}
