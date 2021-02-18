import * as appsync from '@aws-cdk/aws-appsync';
import * as cognito from '@aws-cdk/aws-cognito';
import * as ddb from '@aws-cdk/aws-dynamodb';
import * as iam from '@aws-cdk/aws-iam';
import * as lambda from '@aws-cdk/aws-lambda';
import {
  App,
  Stack,
  StackProps,
  CfnParameter,
  CfnOutput,
  Duration,
  CustomResource,
  Fn,
} from '@aws-cdk/core';


export class DDBStack extends Stack {
  constructor(scope: App, id: string, props?: StackProps) {
    super(scope, id, props);
    console.log('props: ', props);

    // CFN Vars
    const application = new CfnParameter(this, 'Application', {
      type: 'String',
      description: 'The name of the Application.',
      default: 'example',
    }).valueAsString;

    const environment = new CfnParameter(this, 'Environment', {
      type: 'String',
      description: 'The name of the Environment where the app is run.',
      default: 'dev',
    }).valueAsString;

    // DynamoDB Table
    const singleTableDesign = new ddb.Table(this, 'SingleTableDesign', {
      tableName: `${application}-${environment}-ddb-table`,
      billingMode: ddb.BillingMode.PAY_PER_REQUEST,
      stream: ddb.StreamViewType.NEW_AND_OLD_IMAGES,
      partitionKey: {
        name: 'pk',
        type: ddb.AttributeType.STRING,
      },
      sortKey: {
        name: 'sk',
        type: ddb.AttributeType.STRING,
      },
    });

    // CFN Outputs
    new CfnOutput(this, 'singleTableDesignStreamArn', {
      exportName: `${application}-${environment}-ddb-stream-arn`,
      value: singleTableDesign.tableStreamArn || '',
    });

    new CfnOutput(this, 'singleTableDesignArn', {
      exportName: `${application}-${environment}-ddb-arn`,
      value: singleTableDesign.tableArn || '',
    });
  }
}

export class CognitoStack extends Stack {
  public readonly response: string;
  constructor(scope: App, id: string, props?: StackProps) {
    super(scope, id, props);

    // CFN Vars
    const application = new CfnParameter(this, 'Application', {
      type: 'String',
      description: 'The name of the Application.',
      default: 'example',
    }).valueAsString;

    const environment = new CfnParameter(this, 'Environment', {
      type: 'String',
      description: 'The name of the Environment where the app is run.',
      default: 'dev',
    }).valueAsString;

    const userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: `${application}-${environment}-user-pool`,
      autoVerify: {
        email: true,
      },
      standardAttributes: {
        email: {
          required: true,
          mutable: false,
        },
      },
      signInCaseSensitive: false,
      selfSignUpEnabled: true,
    });

    const userPoolClientWeb = new cognito.UserPoolClient(this, 'UserPoolClientWeb', {
      userPoolClientName: `${application}-${environment}-user-pool-clientweb`,
      userPool: userPool,
      refreshTokenValidity: Duration.days(30),
    });

    const userPoolClient = new cognito.UserPoolClient(this, 'UserPoolClient', {
      userPoolClientName: `${application}-${environment}-user-pool-clientweb`,
      userPool: userPool,
      refreshTokenValidity: Duration.days(30),
    });

    const identityPool = new cognito.CfnIdentityPool(this, 'MyCognitoIdentityPool', {
      identityPoolName: `${application}-${environment}-identity-pool`,
      allowUnauthenticatedIdentities: false,
      cognitoIdentityProviders: [
        {
          clientId: userPoolClient.userPoolClientId,
          providerName: userPool.userPoolProviderName,
        },
        {
          clientId: userPoolClientWeb.userPoolClientId,
          providerName: userPool.userPoolProviderName,
        },
      ],
    });

    const authenticatedRole = new iam.Role(this, 'CognitoDefaultAuthenticatedRole', {
      assumedBy:
      new iam.FederatedPrincipal(
        'cognito-identity.amazonaws.com', {
          'StringEquals': {
            'cognito-identity.amazonaws.com:aud': identityPool.ref,
          },
          'ForAnyValue:StringLike': {
            'cognito-identity.amazonaws.com:amr': 'authenticated',
          },
        },
        'sts:AssumeRoleWithWebIdentity',
      ),
    });

    // Unsure if this is required
    authenticatedRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'mobileanalytics:PutEvents',
        'cognito-sync:*',
        'cognito-identity:*',
      ],
      resources: ['*'],
    }));


    const unauthenticatedRole = new iam.Role(this, 'CognitoDefaultUnauthenticatedRole', {
      assumedBy: new iam.FederatedPrincipal(
        'cognito-identity.amazonaws.com', {
          'StringEquals': {
            'cognito-identity.amazonaws.com:aud': identityPool.ref,
          },
          'ForAnyValue:StringLike': {
            'cognito-identity.amazonaws.com:amr': 'unauthenticated',
          },
        }, 'sts:AssumeRoleWithWebIdentity'),
    });

    // Unsure if this is required
    unauthenticatedRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'mobileanalytics:PutEvents',
        'cognito-sync:*',
      ],
      resources: ['*'],
    }));

    // IdentityPoolRoleMap
    new cognito.CfnIdentityPoolRoleAttachment(this, 'DefaultValid', {
      identityPoolId: identityPool.ref,
      roles: {
        unauthenticated: unauthenticatedRole.roleArn,
        authenticated: authenticatedRole.roleArn,
      },
    });

    // const policyDocumentLambdaAssumeRole = {
    //   "Version": "2012-10-17",
    //   "Statement": [
    //     {
    //       "Effect": "Allow",
    //       "Principal": {
    //         "Service": [
    //           "lambda.amazonaws.com"
    //         ]
    //       },
    //       "Action": [
    //         "sts:AssumeRole"
    //       ]
    //     }
    //   ]
    // };

    const userPoolClientLambdaRole = new iam.Role(this, 'UserPoolClientLambdaRole', {
      roleName: `${application}-${environment}-user-pool-client-lambda-role`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });

    const UserPoolClientLambdaPolicy = new iam.Policy(this, 'userPoolClientLambdaPolicy', {
      policyName: `${application}-${environment}-user-pool-client-lambda-policy`,
      roles: [
        userPoolClientLambdaRole,
      ],
    });

    UserPoolClientLambdaPolicy.addStatements(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'cognito-idp:DescribeUserPoolClient',
      ],
      resources: [userPool.userPoolArn],
    }));

    const UserPoolClientLambdaLogPolicy = new iam.Policy(this, 'userPoolClientLambdaLogPolicy', {
      policyName: `${application}-${environment}-user-pool-client-lambda-log-policy`,
      roles: [
        userPoolClientLambdaRole,
      ],
    });

    const UserPoolClientLambda = new lambda.Function(this, 'UserPoolClientLambda', {
      functionName: `${application}-${environment}-user-pool-client-lambda`,
      runtime: lambda.Runtime.NODEJS_10_X,
      handler: 'UserPoolClientLambda.handler',
      code: lambda.Code.fromAsset('lambda'),
      timeout: Duration.seconds(300),
      role: userPoolClientLambdaRole,
    });

    UserPoolClientLambdaLogPolicy.addStatements(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'logs:CreateLogGroup',
        'logs:CreateLogStream',
        'logs:PutLogEvents',
      ],
      resources: [
        Fn.sub(
          `arn:aws:logs:${this.region}:${this.account}:log-group:/aws/lambda/${lambda}:log-stream:*`,
          {
            lambda: UserPoolClientLambda.functionName,
          },
        ),
      ],
    }));

    const userPoolClientInputsCustomResource = new CustomResource(this, 'userPoolClientInputsCustomResource', {
      serviceToken: UserPoolClientLambda.functionArn,
      properties: {
        clientId: userPoolClient.userPoolClientId,
        userpoolId: userPool.userPoolId,
      },
    });

    userPoolClientInputsCustomResource.node.addDependency(UserPoolClientLambda)
    userPoolClientInputsCustomResource.node.addDependency(userPoolClient)
    userPoolClientInputsCustomResource.node.addDependency(userPool)
    userPoolClientInputsCustomResource.node.addDependency(UserPoolClientLambdaLogPolicy)

    this.response = userPoolClientInputsCustomResource.getAtt('Response').toString();

    // CFN Outputs
    new CfnOutput(this, 'cognitoUserPoolId', {
      exportName: `${application}-${environment}-cognito-user-pool-id`,
      value: userPool.userPoolId || '',
    });

    new CfnOutput(this, 'cognitoClientId', {
      exportName: `${application}-${environment}-cognito-client-id`,
      value: userPoolClient.userPoolClientId || '',
    });

    new CfnOutput(this, 'IdentityPoolId', {
      exportName: `${application}-${environment}-cognito-identity-pool-id`,
      value: identityPool.ref,
    });

    new CfnOutput(this, 'cognitoUIURL', {
      exportName: `${application}-${environment}-cognito-ui-url`,
      value: `https://${application}-${environment}.auth.${this.region}.amazoncognito.com/login?client_id=${userPoolClient}&response_type=code&scope=email+openid+phone+profile&redirect_uri=http://localhost:3000` || '',
    });

  }
}


export class AppSyncStack extends Stack {
  constructor(scope: App, id: string, props?: StackProps) {
    super(scope, id, props);
    // CFN Vars
    const application = new CfnParameter(this, 'Application', {
      type: 'String',
      description: 'The name of the Application.',
      default: 'example',
    }).valueAsString;

    const environment = new CfnParameter(this, 'Environment', {
      type: 'String',
      description: 'The name of the Environment where the app is run.',
      default: 'dev',
    }).valueAsString;

    const ddbTableArn = Fn.importValue(`${application}-${environment}-ddb-arn`);
    const ddbTable = ddb.Table.fromTableArn(this, 'DDBTable', ddbTableArn);

    const userPoolId = Fn.importValue(`${application}-${environment}-cognito-user-pool-id`);
    const userPoolArn = `arn:aws:cognito-idp:${this.region}:${this.account}:userpool/${userPoolId}`;
    const userPool = cognito.UserPool.fromUserPoolArn(this, 'UserPool', userPoolArn);

    // Logs Managed Policy and Role
    const apiLogsManagedPolicy = new iam.ManagedPolicy(this, 'ApiLogsManagedPolicy', {
      description: 'Managed policy to allow AWS AppSync to access the logs created by this template.',
      path: '/appsync/',
      statements: [
        new iam.PolicyStatement({
          resources: ['*'],
          actions: [
            'logs:CreateLogGroup',
            'logs:CreateLogStream',
            'logs:PutLogEvents',
          ],
          effect: iam.Effect.ALLOW,
        }),
      ],
    });


    const apiLogsRole = new iam.Role(this, 'ApiLogsRole', {
      roleName: `${application}-${environment}-appsync-logs-role`,
      managedPolicies: [
        apiLogsManagedPolicy,
      ],
      assumedBy: new iam.ServicePrincipal('appsync.amazonaws.com'),
    });


    // Creates the AppSync API
    const api = new appsync.GraphqlApi(this, 'Api', {
      name: `${application}-${environment}-appsync-api`,
      schema: appsync.Schema.fromAsset('graphql/schema.graphql'),
      authorizationConfig: {
        defaultAuthorization: {
          authorizationType: appsync.AuthorizationType.USER_POOL,
          userPoolConfig: {
            userPool: userPool,
            defaultAction: appsync.UserPoolDefaultAction.ALLOW,
          },
        },
      },
      logConfig: {
        excludeVerboseContent: false,
        fieldLogLevel: appsync.FieldLogLevel.ALL,
        role: apiLogsRole,
      },
      xrayEnabled: true,
    });

    // Prints out the AppSync GraphQL endpoint to the terminal
    new CfnOutput(this, 'GraphQLAPIURL', {
      value: api.graphqlUrl,
    });

    // Prints out the AppSync GraphQL API key to the terminal
    new CfnOutput(this, 'GraphQLAPIKey', {
      value: api.apiKey || '',
    });


    // DDB Managed Policy and Role
    const ddbManagedPolicy = new iam.ManagedPolicy(this, 'DDBManagedPolicy', {
      description: 'Managed policy to allow AWS AppSync to access the logs created by this template.',
      path: '/appsync/',
      statements: [
        new iam.PolicyStatement({
          resources: [
            `${ddbTableArn}/*`,
          ],
          actions: [
            'dynamodb:GetItem',
            'dynamodb:PutItem',
            'dynamodb:DeleteItem',
            'dynamodb:UpdateItem',
            'dynamodb:Query',
            'dynamodb:Scan',
            'dynamodb:BatchGetItem',
            'dynamodb:BatchWriteItem',
          ],
          effect: iam.Effect.ALLOW,
        }),
      ],
    });


    const ddbRole = new iam.Role(this, 'DDBRole', {
      roleName: `${application}-${environment}-ddb-role`,
      managedPolicies: [
        ddbManagedPolicy,
      ],
      assumedBy: new iam.ServicePrincipal('appsync.amazonaws.com'),
    });

    const ddbDataSource = new appsync.DynamoDbDataSource(this, 'DDBDataSource', {
      api: api,
      table: ddbTable,
      description: 'single table ddb table',
      serviceRole: ddbRole,
    });

    new appsync.Resolver(this, 'GetUserInfo', {
      api: api,
      typeName: 'Query',
      fieldName: 'getUserInfo',
      dataSource: ddbDataSource,
      requestMappingTemplate: appsync.MappingTemplate.fromString(
        `{
        "version" : "2017-02-28",
        "operation" : "GetItem",
        "key" : {
            "pk" : $util.dynamodb.toDynamoDBJson("userId#$ctx.identity.sub"),
            "sk" : $util.dynamodb.toDynamoDBJson("type#userObject")
        }
      }`,
      )
      ,
      responseMappingTemplate: appsync.MappingTemplate.fromString('$utils.toJson($ctx.result)'),
    });

    new appsync.Resolver(this, 'CreateInitialUser', {
      api: api,
      typeName: 'Mutation',
      fieldName: 'createInitialUser',
      dataSource: ddbDataSource,
      requestMappingTemplate: appsync.MappingTemplate.fromString(`
      {
        "version": "2017-02-28",
        "operation": "PutItem",
        "key": {
          "pk": $util.dynamodb.toDynamoDBJson("userId#$ctx.identity.sub"),
          "sk": $util.dynamodb.toDynamoDBJson("type#userObject")
        },
        "attributeValues" : {
          "user": {
            "M": $util.dynamodb.toMapValuesJson($ctx.args)
          }
        }
      }
    `)
      ,
      responseMappingTemplate: appsync.MappingTemplate.fromString('$utils.toJson($ctx.result)'),
    });
  }
}

// for development, use account/region from cdk cli
const devEnv = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

const app = new App();

new DDBStack(app, 'example-ddb-stack', { env: devEnv });
// new MyStack(app, 'my-stack-prod', { env: prodEnv });


new CognitoStack(app, 'example-cognito-stack', { env: devEnv });
// new MyStack(app, 'my-stack-prod', { env: prodEnv });


// new AppSyncStack(app, 'example-appsync-stack', { env: devEnv });
// new MyStack(app, 'my-stack-prod', { env: prodEnv });

app.synth();