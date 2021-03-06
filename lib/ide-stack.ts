import * as cdk from '@aws-cdk/core';
import * as cfn from '@aws-cdk/aws-cloudformation';
import * as cloud9 from '@aws-cdk/aws-cloud9';
import * as iam from '@aws-cdk/aws-iam';
import * as lambda from '@aws-cdk/aws-lambda';
import * as ssm from '@aws-cdk/aws-ssm';
import * as crpm from 'crpm';
import * as fs from 'fs';
import * as yaml from 'js-yaml';

interface IdeStackProps extends cdk.StackProps {
  cfnRoleName: string;
  clusterName: string;
  lambdaRoleArn: string;
  repoName: string;
}

export class IdeStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props: IdeStackProps) {
    super(scope, id, props);
    
    // Cloud9 Environment
    const cloud9Props = crpm.load<cloud9.CfnEnvironmentEC2Props>(
      `${__dirname}/../res/developer-tools/cloud9/environment-ec2/props.yaml`
    );
    cloud9Props.name = cdk.Aws.STACK_NAME;
    cloud9Props.repositories = [{
      pathComponent: cdk.Fn.join('',
        [
          '/',
          props.repoName
        ]
      ),
      repositoryUrl: cdk.Fn.join('',
        [
          'https://git-codecommit.',
          this.region,
          '.amazonaws.com/v1/repos/',
          props.repoName
        ]
      )
    }];
    const c9 = new cloud9.CfnEnvironmentEC2(this, 'EnvironmentEC2', cloud9Props);
    
    // Instance Profile
    const instanceProfileProps = crpm.load<iam.CfnInstanceProfileProps>(
      `${__dirname}/../res/security-identity-compliance/iam/instance-profile-ide/props.yaml`
    );
    instanceProfileProps.roles = [props.cfnRoleName];
    const instanceProfile = new iam.CfnInstanceProfile(this, "InstanceProfile", instanceProfileProps);
    
    // Systems Manager Document
    const ssmDocDir = `${__dirname}/../res/management-governance/ssm/document-configure-cloud9`;
    const ssmDocProps = crpm.load<ssm.CfnDocumentProps>(`${ssmDocDir}/props.yaml`);
    let ssmDocContent = fs.readFileSync(`${ssmDocDir}/content.yaml`, 'utf8');
    ssmDocContent = ssmDocContent.replace(/\$REGION/g, this.region);
    ssmDocContent = ssmDocContent.replace(/\$CLUSTER_NAME/g, props.clusterName);
    ssmDocProps.content = yaml.safeLoad(ssmDocContent);
    const ssmDoc = new ssm.CfnDocument(this, 'Document', ssmDocProps);
    
    // Lambda Function
    const fnDir = `${__dirname}/../res/compute/lambda/function-custom-resource-ide`;
    const fnProps = crpm.load<lambda.CfnFunctionProps>(`${fnDir}/props.yaml`);
    fnProps.code = {
      zipFile: fs.readFileSync(`${fnDir}/index.js`, 'utf8')
    }
    fnProps.role = props.lambdaRoleArn;
    const fn = new lambda.CfnFunction(this, 'Function', fnProps);
    
    // Custom Resource
    const crProps = crpm.load<cfn.CfnCustomResourceProps>(
      `${__dirname}/../res/management-governance/cloudformation/custom-resource/props.yaml`
    );
    crProps.serviceToken = fn.attrArn;
    const cr = new cfn.CfnCustomResource(this, 'CustomResource', crProps);
    cr.addPropertyOverride('cloud9EnvironmentId', c9.ref);
    cr.addPropertyOverride('instanceProfileName', instanceProfile.ref);
    cr.addPropertyOverride('ssmDocumentName', ssmDoc.ref);
  }
}
